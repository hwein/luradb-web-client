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
      state:[{info.state}] host:[{info.hostLabel}] auth:[{info.authLabel}] server:[{info.serverLabel}] uptime:[{info.uptimeLabel}]
    </p>
  )
}

async function connectSuccessfully(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
  await act(() => connect(makeConnection()))
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

    expect(screen.getByTestId('connection')).toHaveTextContent('state:[unauthenticated] host:[] auth:[] server:[] uptime:[]')
  })

  it('reflects real responses once connected: host, admin role, server version, and uptime', async () => {
    await connectSuccessfully()
    server.use(
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 4260 })),
    )

    renderProbe()

    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent(
        `state:[connected] host:[${window.location.host}${BASE_PATH}] auth:[bearer ✓ admin] server:[luradb 0.1.0] uptime:[up 1h 11m]`,
      ),
    )
    act(() => disconnect())
  })

  it('omits the uptime while /health does not answer', async () => {
    await connectSuccessfully()
    server.use(
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/health`, () => new HttpResponse(null, { status: 500 })),
    )

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('auth:[bearer ✓ admin]'))
    expect(screen.getByTestId('connection')).toHaveTextContent('server:[luradb 0.1.0] uptime:[]')
    act(() => disconnect())
  })
})
