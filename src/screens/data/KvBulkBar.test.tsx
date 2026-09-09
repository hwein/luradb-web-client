import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
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
  return <KvBulkBar domain={DOMAIN} apiClient={apiClient} prefix={prefix} initialContains={initialContains} />
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
    server.use(
      keysHandler(['a', 'b', 'c'], () => {
        scanCalls += 1
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
})
