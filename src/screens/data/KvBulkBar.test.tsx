import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { getRecordedCalls } from '../../api/recorder'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { kvKeyScan, server } from '../../test/msw'
import { resetDocsState, useDocsState } from '../docs/docsStore'
import { KvBulkBar } from './KvBulkBar'

const ORIGIN = window.location.origin
const DOMAIN = 'sessions'
const KEYS_URL = `${ORIGIN}/store-api/kv/${DOMAIN}/keys`

function keyUrl(key: string): string {
  return `${KEYS_URL}/${key}`
}

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent ?? ''
}

function DocsRouteProbe() {
  const docs = useDocsState()
  return <p data-testid="docs-screen">docs: {docs.activeId ?? ''}</p>
}

function Harness({ prefix, initialContains }: { prefix: string; initialContains: string }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <KvBulkBar domain={DOMAIN} apiClient={apiClient} scan={{ prefix, contains: initialContains }} />
}

/** Server-Scan der Leiste: filtert wie der echte Server nach `contains` (Substring, case-sensitiv), `total` = Treffer vor `limit`. */
function keysHandler(keys: string[], onRequest?: (url: URL) => void) {
  return http.get(KEYS_URL, ({ request }) => {
    const url = new URL(request.url)
    onRequest?.(url)
    const contains = url.searchParams.get('contains') ?? ''
    const limit = Number(url.searchParams.get('limit'))
    const matching = keys.filter((key) => key.includes(contains))
    return HttpResponse.json(kvKeyScan(matching.slice(0, limit), { total: matching.length, limit }))
  })
}

async function renderBar(prefix = '', initialContains = '') {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/data']}>
        <Routes>
          <Route path="/data" element={<Harness prefix={prefix} initialContains={initialContains} />} />
          <Route path="/docs" element={<DocsRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { queryClient }
}

afterEach(() => {
  act(() => disconnect())
  resetDocsState()
})

describe('KvBulkBar', () => {
  it('loads its own selection at limit=10000 with the scan prefix, and narrows it server-side once contains is applied (no client filtering)', async () => {
    const urls: URL[] = []
    server.use(keysHandler(['session:1', 'session:2', 'cart:1'], (url) => urls.push(url)))
    await renderBar('session')

    expect(await screen.findByText('3 keys selected')).toBeInTheDocument()
    expect(textOf('.kv-bulk__scope')).toBe('3 of 3 matching keys · prefix "session"')
    expect(urls[0]?.searchParams.get('limit')).toBe('10000')
    expect(urls[0]?.searchParams.get('offset')).toBe('0')
    expect(urls[0]?.searchParams.get('prefix')).toBe('session')
    expect(urls[0]?.searchParams.has('contains')).toBe(false)

    // Tippen allein ändert die Selektion nicht — erst apply schickt den Filter.
    fireEvent.change(screen.getByLabelText('bulk key filter'), { target: { value: ':1' } })
    expect(screen.getByText('3 keys selected')).toBeInTheDocument()
    expect(urls).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'apply' }))

    expect(await screen.findByText('2 keys selected')).toBeInTheDocument()
    expect(urls[1]?.searchParams.get('contains')).toBe(':1')
    expect(textOf('.kv-bulk__scope')).toBe('2 of 2 matching keys · prefix "session" · contains ":1"')
    expect(screen.getByText('session:1')).toBeInTheDocument()
    expect(screen.getByText('cart:1')).toBeInTheDocument()
    expect(screen.queryByText('session:2')).not.toBeInTheDocument()
  })

  it('starts from the committed head scan: the contains filter is pre-filled and sent with the first request', async () => {
    const urls: URL[] = []
    server.use(keysHandler(['session:1', 'session:2'], (url) => urls.push(url)))
    await renderBar('session', ':2')

    expect(await screen.findByText('1 keys selected')).toBeInTheDocument()
    expect(screen.getByLabelText('bulk key filter')).toHaveValue(':2')
    expect(urls[0]?.searchParams.get('contains')).toBe(':2')
    expect(textOf('.kv-bulk__scope')).toBe('1 of 1 matching keys · prefix "session" · contains ":2"')
  })

  it('shows the honest cap line when the server total exceeds the loaded page, and keeps the actions enabled', async () => {
    server.use(http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['a', 'b', 'c'], { total: 12000, limit: 10000 }))))
    await renderBar()

    // Die Zeile nennt die tatsächlich geladene Zahl (am Cap 10,000), nicht die angefragte.
    expect(await screen.findByText('3 of 12,000 matching keys loaded — the run covers the loaded keys only')).toBeInTheDocument()
    expect(textOf('.kv-bulk__scope')).toBe('3 of 12,000 matching keys')
    fireEvent.click(screen.getByLabelText('delete'))
    expect(screen.getByRole('button', { name: 'run…' })).toBeEnabled()
  })

  it('caps the preview at 200 rows while the selection itself stays complete', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `session:${String(i).padStart(3, '0')}`)
    server.use(keysHandler(keys))
    await renderBar()

    expect(await screen.findByText('250 keys selected')).toBeInTheDocument()
    expect(document.querySelectorAll('.kv-bulk__preview-row')).toHaveLength(200)
    expect(screen.getByText('… and 50 more keys')).toBeInTheDocument()
    expect(screen.queryByText(/matching keys loaded/)).not.toBeInTheDocument()
  })

  it('disables run with an empty selection and describes the pending call pattern as "not recorded"', async () => {
    server.use(keysHandler([]))
    await renderBar()
    expect(await screen.findByText('0 keys selected')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('delete'))

    expect(screen.getByRole('button', { name: 'run…' })).toBeDisabled()
    expect(textOf('.kv-bulk__call-pattern')).toContain(`0 × DELETE /store-api/kv/${DOMAIN}/keys/{key} · not recorded`)
  })

  it('arms a confirmation naming action/domain/count, cancels without any request, then confirms and runs delete', async () => {
    let deleteCalls = 0
    let scanCalls = 0
    let serverDeletes = 0
    server.use(
      keysHandler(['a', 'b', 'c'], () => {
        scanCalls += 1
      }),
      http.delete(KEYS_URL, () => {
        serverDeletes += 1
        return HttpResponse.json({ deleted: 0 })
      }),
      http.delete(`${KEYS_URL}/:key`, () => {
        deleteCalls += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { queryClient } = await renderBar()
    expect(await screen.findByText('3 keys selected')).toBeInTheDocument()
    queryClient.setQueryData(['kv-keys', DOMAIN, '', ''], { pages: [], pageParams: [] })
    const recordedDeletes = () => getRecordedCalls().filter((call) => call.method === 'DELETE').length
    expect(recordedDeletes()).toBe(0)

    fireEvent.click(screen.getByLabelText('delete'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    expect(await screen.findByRole('button', { name: 'cancel' })).toBeInTheDocument()
    expect(textOf('.kv-bulk__confirm-text')).toContain('delete 3 keys in "sessions"?')
    expect(textOf('.kv-bulk__confirm-text')).toContain('this cannot be undone.')

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(screen.getByRole('button', { name: 'run…' })).toBeInTheDocument()
    expect(deleteCalls).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    expect(await screen.findByText(/ok 3/)).toBeInTheDocument()
    expect(screen.getByText('failed 0')).toBeInTheDocument()
    expect(deleteCalls).toBe(3)
    // Leerer Prefix ⇒ kein Server-Endpunkt (spec data/013 §1), der Fanout bleibt.
    expect(serverDeletes).toBe(0)
    // Fanout läuft ohne withCall/Recorder (spec §5) — RECENT REQUESTS sieht trotz 3 echter DELETEs keinen (nur den Scan-Refetch).
    expect(recordedDeletes()).toBe(0)
    await waitFor(() => expect(queryClient.getQueryState(['kv-keys', DOMAIN, '', ''])?.isInvalidated).toBe(true))
    // Die eigene Selektionsgrundlage zieht mit (aktiv beobachtet ⇒ sofortiger Refetch) — sonst stünde die Leiste nach ihrem Lauf auf altem Stand (spec data/011 §8).
    await waitFor(() => expect(scanCalls).toBe(2))
  })

  it('runs PUT with an empty text/plain body for "set value to \\"\\""', async () => {
    const bodies: string[] = []
    server.use(
      keysHandler(['a', 'b']),
      http.put(`${KEYS_URL}/:key`, async ({ request }) => {
        bodies.push(await request.text())
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await renderBar()
    expect(await screen.findByText('2 keys selected')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('set value to ""'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    expect(await screen.findByText(/ok 2/)).toBeInTheDocument()
    expect(screen.getByText('failed 0')).toBeInTheDocument()
    expect(bodies).toEqual(['', ''])
  })

  it('runs PATCH …/null for "set null" and shows the explicit-null-state hint', async () => {
    server.use(keysHandler(['a']), http.patch(`${KEYS_URL}/:key/null`, () => new HttpResponse(null, { status: 200 })))
    await renderBar()
    expect(await screen.findByText('1 keys selected')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('set null'))
    expect(screen.getByText(/sets an explicit null state — the key stays listed, reads answer 204/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))
    expect(await screen.findByText(/ok 1/)).toBeInTheDocument()
    expect(screen.getByText('failed 0')).toBeInTheDocument()
  })

  it('the null-state hint docs link opens the kv-engine article', async () => {
    server.use(keysHandler(['a']))
    await renderBar()
    fireEvent.click(screen.getByLabelText('set null'))

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))

    expect(await screen.findByTestId('docs-screen')).toHaveTextContent('docs: kv-engine')
  })

  it('collects a 429 with its original text into the failure list while the other key still succeeds', async () => {
    server.use(
      keysHandler(['rate-limited', 'ok-key']),
      http.delete(keyUrl('rate-limited'), () => new HttpResponse('rate limit exceeded, retry in 2s', { status: 429 })),
      http.delete(keyUrl('ok-key'), () => new HttpResponse(null, { status: 204 })),
    )
    await renderBar()
    expect(await screen.findByText('2 keys selected')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('delete'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    expect(await screen.findByText(/ok 1/)).toBeInTheDocument()
    expect(screen.getByText('failed 1')).toBeInTheDocument()
    expect(screen.getByText('rate-limited · rate limit exceeded, retry in 2s')).toBeInTheDocument()
  })

  describe('server-side delete (spec data/013)', () => {
    it('with a scan prefix, delete runs as one DELETE …/keys?prefix= (recorded), names the criterion, shows the server count and invalidates', async () => {
      const serverDeletes: URL[] = []
      let keyDeletes = 0
      server.use(
        keysHandler(['user-1', 'user-2', 'user-3']),
        http.delete(KEYS_URL, async ({ request }) => {
          serverDeletes.push(new URL(request.url))
          await delay(150)
          return HttpResponse.json({ deleted: 3 })
        }),
        http.delete(`${KEYS_URL}/:key`, () => {
          keyDeletes += 1
          return new HttpResponse(null, { status: 204 })
        }),
      )
      const { queryClient } = await renderBar('user-')
      expect(await screen.findByText('3 keys selected')).toBeInTheDocument()
      queryClient.setQueryData(['kv-keys', DOMAIN, 'user-', ''], { pages: [], pageParams: [] })
      queryClient.setQueryData(['kv-value', DOMAIN, 'user-1'], { state: 'found', bytes: 1, text: 'x' })
      const recordedBefore = getRecordedCalls().filter((call) => call.method === 'DELETE').length

      fireEvent.click(screen.getByLabelText('delete'))
      expect(textOf('.kv-bulk__call-pattern')).toBe(`DELETE /store-api/kv/${DOMAIN}/keys?prefix=user-`)
      fireEvent.click(screen.getByRole('button', { name: 'run…' }))
      expect(textOf('.kv-bulk__confirm-text')).toBe('delete all keys with prefix "user-" in "sessions"? this cannot be undone.')

      fireEvent.click(await screen.findByRole('button', { name: 'run' }))

      expect(await screen.findByText('deleting…')).toBeInTheDocument()
      expect(await screen.findByText('deleted 3')).toBeInTheDocument()
      expect(screen.queryByText(/failed/)).not.toBeInTheDocument()
      expect(screen.queryByText('deleting…')).not.toBeInTheDocument()
      expect(serverDeletes).toHaveLength(1)
      expect(serverDeletes[0]?.searchParams.get('prefix')).toBe('user-')
      expect(serverDeletes[0]?.searchParams.has('contains')).toBe(false)
      expect(keyDeletes).toBe(0)
      // Ein Call, bewusste Mutation ⇒ aufgezeichnet (spec data/013 §4), im Gegensatz zum Fanout.
      expect(getRecordedCalls().filter((call) => call.method === 'DELETE').length).toBe(recordedBefore + 1)
      await waitFor(() => expect(queryClient.getQueryState(['kv-keys', DOMAIN, 'user-', ''])?.isInvalidated).toBe(true))
      await waitFor(() => expect(queryClient.getQueryState(['kv-value', DOMAIN, 'user-1'])?.isInvalidated).toBe(true))
    })

    it('carries the applied contains filter into the query string, encoded, and into the confirmation copy', async () => {
      const serverDeletes: URL[] = []
      server.use(
        keysHandler(['user:a b', 'user:c']),
        http.delete(KEYS_URL, ({ request }) => {
          serverDeletes.push(new URL(request.url))
          return HttpResponse.json({ deleted: 1 })
        }),
      )
      await renderBar('user:', 'a b')
      expect(await screen.findByText('1 keys selected')).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('delete'))
      expect(textOf('.kv-bulk__call-pattern')).toBe(`DELETE /store-api/kv/${DOMAIN}/keys?prefix=user%3A&contains=a+b`)
      fireEvent.click(screen.getByRole('button', { name: 'run…' }))
      expect(textOf('.kv-bulk__confirm-text')).toContain('delete all keys with prefix "user:" containing "a b" in "sessions"?')
      fireEvent.click(await screen.findByRole('button', { name: 'run' }))

      expect(await screen.findByText('deleted 1')).toBeInTheDocument()
      expect(serverDeletes[0]?.searchParams.get('prefix')).toBe('user:')
      expect(serverDeletes[0]?.searchParams.get('contains')).toBe('a b')
    })

    it('keeps clear and set null on the fanout even with a prefix', async () => {
      let serverDeletes = 0
      const puts: string[] = []
      server.use(
        keysHandler(['user-1', 'user-2']),
        http.delete(KEYS_URL, () => {
          serverDeletes += 1
          return HttpResponse.json({ deleted: 0 })
        }),
        http.put(`${KEYS_URL}/:key`, ({ params }) => {
          puts.push(String(params.key))
          return new HttpResponse(null, { status: 200 })
        }),
      )
      await renderBar('user-')
      expect(await screen.findByText('2 keys selected')).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('set value to ""'))
      expect(textOf('.kv-bulk__call-pattern')).toBe(`2 × PUT /store-api/kv/${DOMAIN}/keys/{key} · not recorded`)
      fireEvent.click(screen.getByRole('button', { name: 'run…' }))
      expect(textOf('.kv-bulk__confirm-text')).toContain('set value to "" on 2 keys in "sessions"?')
      fireEvent.click(await screen.findByRole('button', { name: 'run' }))

      expect(await screen.findByText(/ok 2/)).toBeInTheDocument()
      expect(puts.sort()).toEqual(['user-1', 'user-2'])
      expect(serverDeletes).toBe(0)

      fireEvent.click(screen.getByLabelText('set null'))
      expect(textOf('.kv-bulk__call-pattern')).toBe(`2 × PATCH /store-api/kv/${DOMAIN}/keys/{key}/null · not recorded`)
    })

    it('shows the literal 413 server text, no deleted line, and does not invalidate the key list', async () => {
      server.use(
        keysHandler(['big-1', 'big-2']),
        http.delete(KEYS_URL, () => HttpResponse.text('413 Payload Too Large: 10500 keys match the selection, limit is 10000', { status: 413 })),
      )
      const { queryClient } = await renderBar('big-')
      expect(await screen.findByText('2 keys selected')).toBeInTheDocument()
      queryClient.setQueryData(['kv-keys', DOMAIN, 'big-', ''], { pages: [], pageParams: [] })

      fireEvent.click(screen.getByLabelText('delete'))
      fireEvent.click(screen.getByRole('button', { name: 'run…' }))
      fireEvent.click(await screen.findByRole('button', { name: 'run' }))

      expect(await screen.findByText('413 Payload Too Large: 10500 keys match the selection, limit is 10000')).toBeInTheDocument()
      expect(screen.queryByText(/deleted \d/)).not.toBeInTheDocument()
      expect(screen.queryByText(/failed/)).not.toBeInTheDocument()
      expect(queryClient.getQueryState(['kv-keys', DOMAIN, 'big-', ''])?.isInvalidated).toBe(false)
      expect(screen.getByRole('button', { name: 'run…' })).toBeEnabled()
    })
  })
})

