import { act, render, screen } from '@testing-library/react'
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test/msw'
import type { Connection } from './connections'
import { isMixedContentBlocked } from './crossOrigin'
import { connect, disconnect, useConnectedSession, useSession } from './session'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('./crossOrigin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./crossOrigin')>()),
  isMixedContentBlocked: vi.fn(() => false),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const ORIGIN = window.location.origin

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
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
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.0' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(/minimum supported/)
  })

  it('connects to any server at or above the minimum', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.2' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(/connected 0\.7\.2/)
  })

  it('connects cleanly on a matching version', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent('connected 0.7.1')
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

})

describe('browser connect errors (proxy path and direct url)', () => {
  it('reports unreachable without a certificate or cors hint on the proxy path (empty url)', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.error()))
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: '' } })))

    expect(screen.getByTestId('session')).toHaveTextContent(`server unreachable at ${ORIGIN}`)
    expect(screen.getByTestId('session')).not.toHaveTextContent(/self-signed certificate/)
    expect(screen.getByTestId('session')).not.toHaveTextContent(/cross-origin request/)
  })

  it('appends the cors hint, not the certificate hint, when a direct url is unreachable', async () => {
    server.use(http.get('http://luradb.test:3000/version', () => HttpResponse.error()))
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: 'http://luradb.test:3000' } })))

    expect(screen.getByTestId('session')).toHaveTextContent('server unreachable at http://luradb.test:3000')
    expect(screen.getByTestId('session')).toHaveTextContent(/cross-origin request/)
    expect(screen.getByTestId('session')).not.toHaveTextContent(/self-signed certificate/)
  })

  it('reports mixed content without sending a request', async () => {
    let versionCalls = 0
    server.use(
      http.get('http://luradb.test:3000/version', () => {
        versionCalls += 1
        return HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })
      }),
    )
    vi.mocked(isMixedContentBlocked).mockReturnValueOnce(true)
    render(<SessionProbe />)

    await act(() => connect(makeConnection({ type: { kind: 'rest', url: 'http://luradb.test:3000' } })))

    expect(screen.getByTestId('session')).toHaveTextContent('(mixed content)')
    expect(screen.getByTestId('session')).toHaveTextContent('luradb.test:3000')
    expect(versionCalls).toBe(0)
  })
})

function ConnectedSessionProbe() {
  const connected = useConnectedSession()
  if (connected === undefined) return <p data-testid="connected-session">undefined</p>
  return (
    <p data-testid="connected-session">
      {connected.serverVersion} {connected.connectionId}
    </p>
  )
}

describe('useConnectedSession', () => {
  it('is undefined while not connected', () => {
    disconnect()
    render(<ConnectedSessionProbe />)

    expect(screen.getByTestId('connected-session')).toHaveTextContent('undefined')
  })

  it('exposes apiClient, serverVersion and connectionId once connected', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.3' })))
    render(<ConnectedSessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('connected-session')).toHaveTextContent('0.7.3 conn-1')
    act(() => disconnect())
  })
})

describe('disconnect', () => {
  it('returns to the unauthenticated gate', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })))
    render(<SessionProbe />)
    await act(() => connect(makeConnection()))
    expect(screen.getByTestId('session')).toHaveTextContent('connected')

    act(() => disconnect())

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated')
  })
})
