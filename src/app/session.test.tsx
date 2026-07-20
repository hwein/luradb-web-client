import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/msw'
import type { Connection } from './connections'
import { connect, disconnect, useSession } from './session'

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

  it('rejects a foreign major version', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '1.0.0', server_version: '1.0.0' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(/major/)
  })

  it('connects with a one-time warning when the server has a newer minor version', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent(/connected 0\.2\.0/)
    expect(screen.getByTestId('session')).toHaveTextContent(/newer/)
  })

  it('connects cleanly on a matching version', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
    render(<SessionProbe />)

    await act(() => connect(makeConnection()))

    expect(screen.getByTestId('session')).toHaveTextContent('connected 0.1.0')
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
