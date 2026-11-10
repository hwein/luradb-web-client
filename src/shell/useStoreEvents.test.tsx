import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { ApiClient } from '../api'
import { WHOAMI_KEY, useCapabilities } from '../app/capabilities'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect, useSession } from '../app/session'
import { server } from '../test/msw'
import { DOMAINS_KEY } from './domains'
import { useStoreEvents } from './useStoreEvents'

const ORIGIN = window.location.origin
const encoder = new TextEncoder()
const ALL_STORE_KEYS = [DOMAINS_KEY, ['rel-tables'], ['rel-views'], ['json-indexes']]
/** Mehrfaches Debounce-Fenster des Hooks (300 ms) — danach hätte ein gelesener Frame längst invalidiert. */
const PAST_DEBOUNCE_MS = 900

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

const adminWhoami: HttpResponseResolver = () => HttpResponse.json({ name: 'admin', role: 'Admin' })
const userWhoami: HttpResponseResolver = () => HttpResponse.json({ name: 'alice', role: 'User' })

/** Verbindet und liefert den ApiClient der Sitzung — Aufhänger für den `openStream`-Spy. */
async function connectSession(whoami: HttpResponseResolver = adminWhoami): Promise<ApiClient> {
  server.use(
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
    http.get(`${ORIGIN}/store-api/auth/whoami`, whoami),
  )
  await act(() => connect(makeConnection()))

  const { result, unmount } = renderHook(() => useSession())
  const session = result.current
  unmount()
  if (session.status !== 'connected') throw new Error(`expected a connected session, got ${session.status}`)
  return session.apiClient
}

/** Streamt die Frames und hält den Body offen (kein Reconnect während des Tests). */
function eventStream(frames: string[]) {
  return http.get(`${ORIGIN}/store-api/events`, () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
      },
    })
    return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
}

/** Erster Open endet sofort (⇒ Reconnect nach Backoff), der zweite bleibt offen. */
function reconnectingStream() {
  let call = 0
  return http.get(`${ORIGIN}/store-api/events`, () => {
    call += 1
    const endsImmediately = call === 1
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (endsImmediately) controller.close()
      },
    })
    return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
}

function storeFrame(id: string, type: string, payload: { engine?: string; domain: string; object?: string }): string {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ ...payload, type, ts: 1788007646 })}\n\n`
}

/** QueryClient plus Spy — die Invalidierungen sind die einzige Wirkung des Hooks. */
function probeQueryClient(): { queryClient: QueryClient; invalidate: InvalidateSpy } {
  const queryClient = createAppQueryClient()
  return { queryClient, invalidate: vi.spyOn(queryClient, 'invalidateQueries') }
}

type InvalidateSpy = MockInstance<QueryClient['invalidateQueries']>

function invalidatedKeys(invalidate: InvalidateSpy): unknown[] {
  return invalidate.mock.calls.map(([filters]) => filters?.queryKey)
}

function StoreEventsProbe() {
  useStoreEvents()
  const { admin } = useCapabilities()
  return <span data-testid="admin">{admin}</span>
}

function renderProbe(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <StoreEventsProbe />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
})

describe('useStoreEvents', () => {
  it('opens exactly one stream on /store-api/events for an admin session', async () => {
    const apiClient = await connectSession()
    const openStream = vi.spyOn(apiClient, 'openStream')
    server.use(eventStream([]))

    renderProbe(createAppQueryClient())

    await waitFor(() => expect(openStream).toHaveBeenCalledTimes(1))
    expect(openStream.mock.calls.map(([path]) => path)).toEqual(['/store-api/events'])
  })

  it.each([
    ['no', userWhoami],
    ['error', () => new HttpResponse(null, { status: 500 })],
  ])('opens no stream while the admin capability is %s', async (expected, whoami) => {
    const apiClient = await connectSession(whoami)
    const openStream = vi.spyOn(apiClient, 'openStream')
    server.use(eventStream([]))

    renderProbe(createAppQueryClient())

    await waitFor(() => expect(screen.getByTestId('admin')).toHaveTextContent(expected))
    expect(openStream).not.toHaveBeenCalled()
  })

  it('opens no stream while the admin capability is still pending', async () => {
    const apiClient = await connectSession(() => new Promise<never>(() => {}))
    const openStream = vi.spyOn(apiClient, 'openStream')
    server.use(eventStream([]))

    renderProbe(createAppQueryClient())
    await act(async () => {})

    expect(screen.getByTestId('admin')).toHaveTextContent('pending')
    expect(openStream).not.toHaveBeenCalled()
  })

  it('starts the stream once the admin capability flips to yes', async () => {
    const apiClient = await connectSession(userWhoami)
    const openStream = vi.spyOn(apiClient, 'openStream')
    server.use(eventStream([]))
    const queryClient = createAppQueryClient()

    renderProbe(queryClient)
    await waitFor(() => expect(screen.getByTestId('admin')).toHaveTextContent('no'))
    expect(openStream).not.toHaveBeenCalled()

    server.use(http.get(`${ORIGIN}/store-api/auth/whoami`, adminWhoami))
    await act(() => queryClient.invalidateQueries({ queryKey: WHOAMI_KEY }))

    await waitFor(() => expect(openStream).toHaveBeenCalledTimes(1))
  })

  it('invalidates the table list of the named domain and nothing else', async () => {
    await connectSession()
    server.use(eventStream([storeFrame('g-a-1', 'table_created', { engine: 'rel', domain: 'probe', object: 't1' })]))
    const { queryClient, invalidate } = probeQueryClient()

    renderProbe(queryClient)

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual([['rel-tables', 'probe']])
  })

  it('bundles the events of one debounce window into a single deduplicated flush', async () => {
    await connectSession()
    server.use(
      eventStream([
        storeFrame('g-a-1', 'domain_created', { domain: 'probe' }),
        storeFrame('g-a-2', 'table_created', { engine: 'rel', domain: 'probe', object: 't1' }),
        storeFrame('g-a-3', 'domain_deleted', { domain: 'other' }),
        storeFrame('g-a-4', 'table_created', { engine: 'rel', domain: 'probe', object: 't2' }),
      ]),
    )
    const { queryClient, invalidate } = probeQueryClient()

    renderProbe(queryClient)

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual([DOMAINS_KEY, ['rel-tables', 'probe']])
  })

  it('ignores frames without a mapped target', async () => {
    await connectSession()
    server.use(
      eventStream([
        storeFrame('g-a-1', 'index_created', { engine: 'rel', domain: 'probe', object: 'idx' }),
        storeFrame('g-a-2', 'table_created', { engine: 'rel', domain: 'probe', object: 't1' }),
      ]),
    )
    const { queryClient, invalidate } = probeQueryClient()

    renderProbe(queryClient)

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual([['rel-tables', 'probe']])
  })

  it('resyncs the six explorer prefixes on a reset frame', async () => {
    await connectSession()
    server.use(eventStream(['id: g-a-9\nevent: reset\ndata: {"reason":"window_exceeded"}\n\n']))
    const { queryClient, invalidate } = probeQueryClient()

    renderProbe(queryClient)

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual(ALL_STORE_KEYS)
  })

  it('resyncs on the second connect only — the first one rides along with the mount loads', async () => {
    const apiClient = await connectSession()
    const openStream = vi.spyOn(apiClient, 'openStream')
    server.use(reconnectingStream())
    const { queryClient, invalidate } = probeQueryClient()

    renderProbe(queryClient)

    await waitFor(() => expect(openStream).toHaveBeenCalledTimes(1))
    expect(invalidate).not.toHaveBeenCalled()

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidatedKeys(invalidate)).toEqual(ALL_STORE_KEYS)
  })

  it('records the first open and keeps every reconnect out of the recorder', async () => {
    const apiClient = await connectSession()
    const openStream = vi.spyOn(apiClient, 'openStream')
    server.use(reconnectingStream())

    renderProbe(createAppQueryClient())

    await waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
    expect(openStream.mock.calls.map(([, options]) => options)).toEqual([
      { lastEventId: undefined, silentRecord: false },
      { lastEventId: undefined, silentRecord: true },
    ])
  })

  it('invalidates the session on 401, like the kv watch', async () => {
    await connectSession()
    server.use(http.get(`${ORIGIN}/store-api/events`, () => new HttpResponse(null, { status: 401 })))
    const { queryClient } = probeQueryClient()
    const clear = vi.spyOn(queryClient, 'clear')

    renderProbe(queryClient)

    await waitFor(() => expect(clear).toHaveBeenCalled())
    expect(screen.getByTestId('admin')).toHaveTextContent('pending')
  })

  it('stops consuming the stream when the session goes away', async () => {
    await connectSession()
    let push: ((frame: string) => void) | undefined
    server.use(
      http.get(`${ORIGIN}/store-api/events`, () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (frame) => controller.enqueue(encoder.encode(frame))
          },
        })
        return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
      }),
    )
    const { queryClient, invalidate } = probeQueryClient()

    renderProbe(queryClient)
    await waitFor(() => expect(push).toBeDefined())
    push?.(storeFrame('g-a-1', 'table_created', { engine: 'rel', domain: 'probe', object: 't1' }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))

    act(() => disconnect())
    push?.(storeFrame('g-a-2', 'view_created', { engine: 'rel', domain: 'probe', object: 'v1' }))
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS))

    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
