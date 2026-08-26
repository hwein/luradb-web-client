import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
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
  const { admin, adminError } = useCapabilities()
  return (
    <p data-testid="capabilities">
      admin: {admin}
      {adminError !== undefined && <span data-testid="admin-error">{adminError}</span>}
    </p>
  )
}

async function connectSuccessfully(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))
}

describe('useCapabilities', () => {
  it('derives admin: yes from a 200 on /auth/users', async () => {
    await connectSuccessfully()
    server.use(http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])))

    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: yes'))
    act(() => disconnect())
  })

  it('derives admin: no from a 401/403 on /auth/users — a regular gate, not an error', async () => {
    await connectSuccessfully()
    server.use(http.get(`${ORIGIN}/store-api/auth/users`, () => new HttpResponse(null, { status: 403 })))

    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: no'))
    expect(screen.queryByTestId('admin-error')).not.toBeInTheDocument()
    act(() => disconnect())
  })

  it('derives admin: error (with the response detail) from a 500 on /auth/users', async () => {
    await connectSuccessfully()
    server.use(http.get(`${ORIGIN}/store-api/auth/users`, () => new HttpResponse(null, { status: 500 })))

    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: error'))
    expect(screen.getByTestId('admin-error')).toHaveTextContent('unexpected response (HTTP 500)')
    act(() => disconnect())
  })

  it('is pending while not connected (the probe never runs, no false "no")', () => {
    disconnect()
    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: pending')
  })
})
