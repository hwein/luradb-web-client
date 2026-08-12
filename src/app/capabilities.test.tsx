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
  const { admin } = useCapabilities()
  return <p data-testid="capabilities">admin: {String(admin)}</p>
}

async function connectSuccessfully(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))
}

describe('useCapabilities', () => {
  it('derives admin from a 200 on /auth/users', async () => {
    await connectSuccessfully()
    server.use(http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])))

    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: true'))
    act(() => disconnect())
  })

  it('derives non-admin from a non-200 on /auth/users', async () => {
    await connectSuccessfully()
    server.use(http.get(`${ORIGIN}/store-api/auth/users`, () => new HttpResponse(null, { status: 403 })))

    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: false'))
    act(() => disconnect())
  })

  it('is false while not connected', () => {
    disconnect()
    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProbe />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('capabilities')).toHaveTextContent('admin: false')
  })
})
