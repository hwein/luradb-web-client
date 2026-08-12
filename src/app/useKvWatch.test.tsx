import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../test/msw'
import type { Connection } from './connections'
import { createAppQueryClient } from './queryClient'
import { connect, disconnect, useSession } from './session'
import { useKvWatch } from './useKvWatch'

const ORIGIN = window.location.origin
const encoder = new TextEncoder()

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

/** MSW-Handler, der die Frames streamt und den Body offen hält (kein Reconnect während des Tests). */
function watchStream(frames: string[]) {
  return http.get(`${ORIGIN}/store-api/kv/default/watch`, () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
      },
    })
    return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
}

async function connectSession(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))
}

function WatchProbe({ prefix }: { prefix?: string }) {
  const session = useSession()
  const { events, connectionState, clear } = useKvWatch('default', prefix)
  return (
    <div>
      <span data-testid="session">{session.status}</span>
      <span data-testid="state">{connectionState}</span>
      <span data-testid="count">{events.length}</span>
      <span data-testid="events">{events.map((e) => `${e.type}:${e.key}:${e.dataRaw}`).join(',')}</span>
      <button type="button" onClick={clear}>
        clear
      </button>
    </div>
  )
}

function renderProbe(prefix?: string) {
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <WatchProbe prefix={prefix} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
})

describe('useKvWatch', () => {
  it('maps set/delete frames to typed events, newest first', async () => {
    await connectSession()
    server.use(watchStream(['event: set\ndata: alpha\n\n', 'event: delete\ndata: beta\n\n']))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))
    expect(screen.getByTestId('state')).toHaveTextContent('connected')
    expect(screen.getByTestId('events')).toHaveTextContent('delete:beta:beta,set:alpha:alpha')
  })

  it('caps the list at 500, newest first', async () => {
    await connectSession()
    const frames = Array.from({ length: 501 }, (_, i) => `event: set\ndata: k${i}\n\n`)
    server.use(watchStream(frames))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('500'))
    const events = screen.getByTestId('events').textContent ?? ''
    expect(events.startsWith('set:k500:k500')).toBe(true)
    expect(events.endsWith('set:k1:k1')).toBe(true)
    expect(events).not.toContain('k0:')
  })

  it('clear() empties the list but keeps the connection', async () => {
    await connectSession()
    server.use(watchStream(['event: set\ndata: alpha\n\n']))

    renderProbe()
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    act(() => screen.getByRole('button', { name: 'clear' }).click())

    expect(screen.getByTestId('count')).toHaveTextContent('0')
    expect(screen.getByTestId('state')).toHaveTextContent('connected')
  })

  it('invalidates the session on 401 (disconnect + closed), like the client', async () => {
    await connectSession()
    server.use(http.get(`${ORIGIN}/store-api/kv/default/watch`, () => new HttpResponse(null, { status: 401 })))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('state')).toHaveTextContent('closed')
  })
})
