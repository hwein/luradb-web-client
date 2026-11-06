import { QueryClientProvider, focusManager } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { getRecordedCalls } from '../api/recorder'
import { server } from '../test/msw'
import { useCapabilities } from './capabilities'
import type { Connection } from './connections'
import { createAppQueryClient } from './queryClient'
import { connect, disconnect } from './session'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function CapabilitiesProbe() {
  const { admin, adminError, identity } = useCapabilities()
  return (
    <p data-testid="capabilities">
      admin: {admin}
      {adminError !== undefined && <span data-testid="admin-error">{adminError}</span>}
      {identity !== undefined && <span data-testid="identity">{`${identity.name}/${identity.role}`}</span>}
    </p>
  )
}

async function connectSuccessfully(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.14.2', server_version: '0.5.1' })))
  await act(() => connect(makeConnection()))
}

function renderProbe() {
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <CapabilitiesProbe />
    </QueryClientProvider>,
  )
  return queryClient
}

function whoamiReturns(body: { name: string | null; role: string }) {
  return http.get(`${ORIGIN}/store-api/auth/whoami`, () => HttpResponse.json(body))
}

function whoamiStatus(status: number) {
  return http.get(`${ORIGIN}/store-api/auth/whoami`, () => new HttpResponse('Unauthorized', { status }))
}

describe('useCapabilities', () => {
  it('derives admin: yes plus the identity from whoami role Admin', async () => {
    await connectSuccessfully()
    server.use(whoamiReturns({ name: 'admin', role: 'Admin' }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: yes'))
    expect(screen.getByTestId('identity')).toHaveTextContent('admin/Admin')
    act(() => disconnect())
  })

  it('derives admin: no plus the identity from whoami role User', async () => {
    await connectSuccessfully()
    server.use(whoamiReturns({ name: 'alice', role: 'User' }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: no'))
    expect(screen.getByTestId('identity')).toHaveTextContent('alice/User')
    act(() => disconnect())
  })

  it('maps an unknown role to admin: no (least privilege) and keeps the identity', async () => {
    await connectSuccessfully()
    server.use(whoamiReturns({ name: 'eve', role: 'Auditor' }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: no'))
    expect(screen.getByTestId('identity')).toHaveTextContent('eve/Auditor')
    act(() => disconnect())
  })

  it('maps TrustedPeer (no name) to admin: no without an identity', async () => {
    await connectSuccessfully()
    server.use(whoamiReturns({ name: null, role: 'TrustedPeer' }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: no'))
    expect(screen.queryByTestId('identity')).not.toBeInTheDocument()
    act(() => disconnect())
  })

  it('maps Disabled (open server, no name) to admin: yes without an identity', async () => {
    await connectSuccessfully()
    server.use(whoamiReturns({ name: null, role: 'Disabled' }))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: yes'))
    expect(screen.queryByTestId('identity')).not.toBeInTheDocument()
    act(() => disconnect())
  })

  it.each([500, 404])('derives admin: error (with the response detail) from a %s on whoami (404 = server too old)', async (status) => {
    await connectSuccessfully()
    server.use(whoamiStatus(status))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: error'))
    expect(screen.getByTestId('admin-error')).toHaveTextContent(`unexpected response (HTTP ${status})`)
    expect(screen.queryByTestId('identity')).not.toBeInTheDocument()
    act(() => disconnect())
  })

  it.each([401, 403])('derives admin: no without identity or error from a %s on whoami — a regular gate, not an error', async (status) => {
    await connectSuccessfully()
    server.use(whoamiStatus(status))

    renderProbe()

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: no'))
    expect(screen.queryByTestId('admin-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('identity')).not.toBeInTheDocument()
    act(() => disconnect())
  })

  it('records exactly one whoami call per session — no second one after a focus refetch', async () => {
    await connectSuccessfully()
    server.use(whoamiReturns({ name: 'admin', role: 'Admin' }))
    const whoamiCalls = () => getRecordedCalls().filter((call) => call.path === '/store-api/auth/whoami')

    renderProbe()
    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: yes'))
    expect(whoamiCalls()).toHaveLength(1)

    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(whoamiCalls()).toHaveLength(1)
    expect(whoamiCalls()[0]).toMatchObject({ method: 'GET', status: 200 })
    act(() => disconnect())
  })

  it('is pending while not connected (the probe never runs, no false "no")', () => {
    disconnect()
    renderProbe()

    expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: pending')
  })
})
