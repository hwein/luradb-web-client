import { act, render, screen } from '@testing-library/react'
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test/msw'
import type { Connection } from './connections'
import { connect, disconnect, useSession } from './session'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const ORIGIN = window.location.origin

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
    ...overrides,
  }
}

function SessionProbe() {
  const session = useSession()
  if (session.status === 'connected') {
    return (
      <p data-testid="session">
        connected {session.serverVersion} {session.compatibilityWarning ?? ''}
      </p>
    )
  }
  if (session.status === 'error') return <p data-testid="session">error: {session.message}</p>
  return <p data-testid="session">{session.status}</p>
}

describe('connect', () => {
  it('reports an invalid key on 401', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => new HttpResponse(null, { status: 401 })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent('error: invalid api key')
  })

  it('reports the target url when the server is unreachable', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.error()))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(`server unreachable at ${ORIGIN}`)
  })

  it('treats a 502 from the same-origin proxy as unreachable, not a generic error', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => new HttpResponse(null, { status: 502 })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(`server unreachable at ${ORIGIN}`)
  })

  it('rejects a server below the minimum supported version', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.0.9' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(/minimum supported/)
  })

  it('connects to any server at or above the minimum', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(/connected 0\.2\.0/)
  })

  it('connects cleanly on a matching version', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent('connected 0.1.0')
  })
})

// Der Transport läuft unter __TAURI_INTERNALS__ übers Plugin statt über HTTP — MSW greift dort nicht,
// deshalb steuert @tauri-apps/plugin-http hier direkt per Mock (spec 009).
describe('self-signed certificate hint (desktop, unreachable https://)', () => {
  function stubDesktop(): void {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
  }

  it('is appended for an https:// connection without the flag', async () => {
    stubDesktop()
    vi.mocked(pluginFetch).mockRejectedValueOnce(new Error('error sending request'))
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: 'https://127.0.0.1:3443' } })))

    expect(screen.getByTestId('session')).toHaveTextContent('server unreachable')
    expect(screen.getByTestId('session')).toHaveTextContent(/self-signed certificate/)
  })

  it('is omitted for a plain http:// connection', async () => {
    stubDesktop()
    vi.mocked(pluginFetch).mockRejectedValueOnce(new Error('error sending request'))
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: 'http://127.0.0.1:3000' } })))

    expect(screen.getByTestId('session')).toHaveTextContent('server unreachable')
    expect(screen.getByTestId('session')).not.toHaveTextContent(/self-signed certificate/)
  })

  it('is omitted once the flag is already set', async () => {
    stubDesktop()
    vi.mocked(pluginFetch).mockRejectedValueOnce(new Error('error sending request'))
    render(<SessionProbe />)

    await act(() =>
      connect(makeConnection({ type: { kind: 'rest', url: 'https://127.0.0.1:3443', acceptInvalidCerts: true } })),
    )

    expect(screen.getByTestId('session')).toHaveTextContent('server unreachable')
    expect(screen.getByTestId('session')).not.toHaveTextContent(/self-signed certificate/)
  })

  it('is omitted in the gateway branch, where the TLS handshake already worked', async () => {
    stubDesktop()
    vi.mocked(pluginFetch).mockResolvedValueOnce(new Response(null, { status: 502 }))
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: 'https://127.0.0.1:3443' } })))

    expect(screen.getByTestId('session')).toHaveTextContent('server unreachable')
    expect(screen.getByTestId('session')).not.toHaveTextContent(/self-signed certificate/)
  })

  it('is omitted in the browser, even when the stored url looks like https://', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.error()))
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: 'https://127.0.0.1:3443' } })))

    expect(screen.getByTestId('session')).toHaveTextContent(`server unreachable at ${ORIGIN}`)
    expect(screen.getByTestId('session')).not.toHaveTextContent(/self-signed certificate/)
  })
})

describe('disconnect', () => {
  it('returns to the unauthenticated gate', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
    render(<SessionProbe />)
    await act(() => connect(makeConnection()))
    expect(screen.getByTestId('session')).toHaveTextContent('connected')

    act(() => disconnect())

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated')
  })
})
