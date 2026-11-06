import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { BASE_PATH } from '../api'
import { server } from '../test/msw'
import type { Connection } from './connections'
import { createAppQueryClient } from './queryClient'
import { connect, disconnect } from './session'
import { useConnection } from './useConnection'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function ConnectionProbe() {
  const info = useConnection()
  return (
    <p data-testid="connection">
      state:[{info.state}] host:[{info.hostLabel}] auth:[{info.authLabel}] signedIn:[{info.signedInLabel}] server:[{info.serverLabel}] uptime:[{info.uptimeLabel}] health:[{info.healthLabel}] blocked:[{String(info.healthBlocked)}]
    </p>
  )
}

async function connectSuccessfully(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.14.2', server_version: '0.5.1' })))
  await act(() => connect(makeConnection()))
}

function whoami(status: number, body?: { name: string | null; role: string }) {
  return http.get(`${ORIGIN}/store-api/auth/whoami`, () => (body === undefined ? new HttpResponse(null, { status }) : HttpResponse.json(body, { status })))
}

function renderProbe() {
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProbe />
    </QueryClientProvider>,
  )
}

describe('useConnection', () => {
  it('reports empty defaults while not connected', () => {
    disconnect()
    renderProbe()

    expect(screen.getByTestId('connection')).toHaveTextContent('state:[unauthenticated] host:[] auth:[] signedIn:[] server:[] uptime:[] health:[] blocked:[false]')
  })

  it('reflects real responses once connected: host, role, signed-in user, server version, and uptime', async () => {
    await connectSuccessfully()
    server.use(
      whoami(200, { name: 'admin', role: 'Admin' }),
      http.get(`${ORIGIN}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 4260 })),
    )

    renderProbe()

    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent(
        `state:[connected] host:[${window.location.host}${BASE_PATH}] auth:[bearer ✓ admin] signedIn:[signed in as admin] server:[luradb 0.5.1] uptime:[up 1h 11m]`,
      ),
    )
    act(() => disconnect())
  })

  const HEALTHY = {
    status: 'ok',
    uptime_secs: 60,
    shards: [{ id: 0, status: 'ok' }],
    resources: { state: 'ok', disk_state: 'ok', memory_state: 'ok' },
    io: { failures: 0 },
  }

  it.each([
    [
      'lists every reason in fixed order and marks it blocked',
      {
        ...HEALTHY,
        status: 'degraded',
        shards: [
          { id: 0, status: 'ok' },
          { id: 1, status: 'timeout' },
        ],
        resources: { state: 'blocked', disk_state: 'blocked', memory_state: 'warning' },
        io: { failures: 2 },
      },
      'health:[degraded · shard 1 timeout · writes blocked: disk · memory low · i/o failures: 2] blocked:[true]',
    ],
    [
      'names a low disk as a warning',
      { ...HEALTHY, status: 'degraded', resources: { state: 'warning', disk_state: 'warning', memory_state: 'ok' } },
      'health:[degraded · disk space low] blocked:[false]',
    ],
    [
      'names blocked memory',
      { ...HEALTHY, status: 'degraded', resources: { state: 'blocked', disk_state: 'ok', memory_state: 'blocked' } },
      'health:[degraded · writes blocked: memory] blocked:[true]',
    ],
    ['shows degraded alone without a recognisable reason', { ...HEALTHY, status: 'degraded' }, 'health:[degraded] blocked:[false]'],
    ['is empty while the server is ok', HEALTHY, 'health:[] blocked:[false]'],
  ])('health label %s', async (_name, body, expected) => {
    await connectSuccessfully()
    server.use(whoami(200, { name: 'admin', role: 'Admin' }), http.get(`${ORIGIN}/health`, () => HttpResponse.json(body)))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('uptime:[up 1m]'))
    expect(screen.getByTestId('connection')).toHaveTextContent(expected, { normalizeWhitespace: true })
    act(() => disconnect())
  })

  it('omits the uptime while /health does not answer', async () => {
    await connectSuccessfully()
    server.use(
      whoami(200, { name: 'admin', role: 'Admin' }),
      http.get(`${ORIGIN}/health`, () => new HttpResponse(null, { status: 500 })),
    )

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('auth:[bearer ✓ admin]'))
    expect(screen.getByTestId('connection')).toHaveTextContent('server:[luradb 0.5.1] uptime:[]')
    act(() => disconnect())
  })

  it('labels a regular user with the user role and their own name', async () => {
    await connectSuccessfully()
    server.use(whoami(200, { name: 'alice', role: 'User' }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('auth:[bearer ✓ user] signedIn:[signed in as alice]'))
    act(() => disconnect())
  })

  it.each([
    ['Disabled', 'bearer ✓ admin'],
    ['TrustedPeer', 'bearer ✓ user'],
  ])('has no signed-in label for the nameless %s role', async (role, authLabel) => {
    await connectSuccessfully()
    server.use(whoami(200, { name: null, role }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent(`auth:[${authLabel}] signedIn:[]`))
    act(() => disconnect())
  })

  it('has neither an auth nor a signed-in label while whoami fails', async () => {
    await connectSuccessfully()
    server.use(whoami(500))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('state:[connected]'))
    await act(async () => {})
    expect(screen.getByTestId('connection')).toHaveTextContent('auth:[] signedIn:[]')
    act(() => disconnect())
  })

  it('has neither an auth nor a signed-in label while whoami is still pending', async () => {
    await connectSuccessfully()
    server.use(http.get(`${ORIGIN}/store-api/auth/whoami`, () => new Promise<never>(() => {})))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('state:[connected]'))
    await act(async () => {})
    expect(screen.getByTestId('connection')).toHaveTextContent('auth:[] signedIn:[]')
    act(() => disconnect())
  })
})
