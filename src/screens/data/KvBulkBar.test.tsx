import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { getRecordedCalls } from '../../api/recorder'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
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

function Harness({ keys, prefix = '' }: { keys: string[]; prefix?: string }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <KvBulkBar domain={DOMAIN} apiClient={apiClient} keys={keys} prefix={prefix} />
}

async function renderBar(keys: string[], prefix = '') {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/data']}>
        <Routes>
          <Route path="/data" element={<Harness keys={keys} prefix={prefix} />} />
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
  it('shows the scanned scope and reduces the selection via the contains filter', async () => {
    await renderBar(['session:1', 'session:2', 'cart:1'], 'session')
    expect(textOf('.kv-bulk__scope')).toContain('3 keys scanned (prefix "session")')
    expect(screen.getByText('3 keys selected')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('bulk key filter'), { target: { value: ':1' } })

    expect(await screen.findByText('2 keys selected')).toBeInTheDocument()
    expect(screen.getByText('session:1')).toBeInTheDocument()
    expect(screen.getByText('cart:1')).toBeInTheDocument()
    expect(screen.queryByText('session:2')).not.toBeInTheDocument()
  })

  it('caps the preview at 200 rows while the selection itself stays complete', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `session:${String(i).padStart(3, '0')}`)
    await renderBar(keys)

    expect(screen.getByText('250 keys selected')).toBeInTheDocument()
    expect(document.querySelectorAll('.kv-bulk__preview-row')).toHaveLength(200)
    expect(screen.getByText('… and 50 more keys')).toBeInTheDocument()
  })

  it('disables run with an empty selection and describes the pending call pattern as "not recorded"', async () => {
    await renderBar([])
    fireEvent.click(screen.getByLabelText('delete'))

    expect(screen.getByRole('button', { name: 'run…' })).toBeDisabled()
    expect(textOf('.kv-bulk__call-pattern')).toContain(`0 × DELETE /store-api/kv/${DOMAIN}/keys/{key} · not recorded`)
  })

  it('arms a confirmation naming action/domain/count, cancels without any request, then confirms and runs delete', async () => {
    let deleteCalls = 0
    server.use(
      http.delete(`${KEYS_URL}/:key`, () => {
        deleteCalls += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { queryClient } = await renderBar(['a', 'b', 'c'])
    queryClient.setQueryData(['kv-keys', DOMAIN, ''], { keys: ['a', 'b', 'c'], call: { method: 'GET', path: '', status: 200, ms: 0 } })
    const before = getRecordedCalls().length

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
    // Fanout läuft ohne withCall/Recorder (spec §5) — RECENT REQUESTS bleibt trotz 3 echter DELETEs unverändert.
    expect(getRecordedCalls().length).toBe(before)
    await waitFor(() => expect(queryClient.getQueryState(['kv-keys', DOMAIN, ''])?.isInvalidated).toBe(true))
  })

  it('runs PUT with an empty text/plain body for "set value to \\"\\""', async () => {
    const bodies: string[] = []
    server.use(
      http.put(`${KEYS_URL}/:key`, async ({ request }) => {
        bodies.push(await request.text())
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await renderBar(['a', 'b'])

    fireEvent.click(screen.getByLabelText('set value to ""'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    expect(await screen.findByText(/ok 2/)).toBeInTheDocument()
    expect(screen.getByText('failed 0')).toBeInTheDocument()
    expect(bodies).toEqual(['', ''])
  })

  it('runs PATCH …/null for "set null" and shows the explicit-null-state hint', async () => {
    server.use(http.patch(`${KEYS_URL}/:key/null`, () => new HttpResponse(null, { status: 200 })))
    await renderBar(['a'])

    fireEvent.click(screen.getByLabelText('set null'))
    expect(screen.getByText(/sets an explicit null state — the key stays listed, reads answer 204/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))
    expect(await screen.findByText(/ok 1/)).toBeInTheDocument()
    expect(screen.getByText('failed 0')).toBeInTheDocument()
  })

  it('the null-state hint docs link opens the kv-engine article', async () => {
    await renderBar(['a'])
    fireEvent.click(screen.getByLabelText('set null'))

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))

    expect(await screen.findByTestId('docs-screen')).toHaveTextContent('docs: kv-engine')
  })

  it('collects a 429 with its original text into the failure list while the other key still succeeds', async () => {
    server.use(
      http.delete(keyUrl('rate-limited'), () => new HttpResponse('rate limit exceeded, retry in 2s', { status: 429 })),
      http.delete(keyUrl('ok-key'), () => new HttpResponse(null, { status: 204 })),
    )
    await renderBar(['rate-limited', 'ok-key'])

    fireEvent.click(screen.getByLabelText('delete'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    expect(await screen.findByText(/ok 1/)).toBeInTheDocument()
    expect(screen.getByText('failed 1')).toBeInTheDocument()
    expect(screen.getByText('rate-limited · rate limit exceeded, retry in 2s')).toBeInTheDocument()
  })
})
