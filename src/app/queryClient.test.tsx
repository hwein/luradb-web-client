import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { server } from '../test/msw'
import type { Connection } from './connections'
import { createAppQueryClient, endSession } from './queryClient'
import { connect, disconnect, useSession } from './session'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

async function connectSession(): Promise<void> {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })))
  await act(() => connect(makeConnection()))
}

function SessionProbe() {
  const session = useSession()
  return <span data-testid="session">{session.status}</span>
}

function renderProbe(queryClient = createAppQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProbe />
    </QueryClientProvider>,
  )
  return queryClient
}

afterEach(() => act(() => disconnect()))

describe('endSession', () => {
  it('returns to the unauthenticated gate and empties the query cache', async () => {
    await connectSession()
    const queryClient = renderProbe()
    queryClient.setQueryData(['probe'], 1)
    expect(screen.getByTestId('session')).toHaveTextContent('connected')

    act(() => endSession(queryClient))

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated')
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })
})

describe('createAppQueryClient', () => {
  it('ends the session and empties the query cache on a 401 query error, not on a 500', async () => {
    await connectSession()
    const queryClient = renderProbe()
    queryClient.setQueryData(['probe'], 1)

    await act(() =>
      queryClient.fetchQuery({ queryKey: ['fail-500'], queryFn: () => Promise.reject(new ApiError(500, 'boom')) }).catch(() => undefined),
    )
    expect(screen.getByTestId('session')).toHaveTextContent('connected')
    expect(queryClient.getQueryData(['probe'])).toBe(1)

    await act(() =>
      queryClient.fetchQuery({ queryKey: ['fail-401'], queryFn: () => Promise.reject(new ApiError(401, 'denied')) }).catch(() => undefined),
    )
    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated')
    expect(queryClient.getQueryData(['probe'])).toBeUndefined()
  })
})
