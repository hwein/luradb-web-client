import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { server } from '../../test/msw'
import { AuthCard } from './AuthCard'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function renderAuthCard() {
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <AuthCard />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
})

describe('AuthCard', () => {
  it('derives auth.enabled = true (green) from a 401 on the headerless probe, sending no Authorization header', async () => {
    let sawAuthHeader = false
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })),
      http.get(`${ORIGIN}/store-api/domains`, ({ request }) => {
        if (request.headers.has('authorization')) sawAuthHeader = true
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderAuthCard()

    expect(await screen.findByText('true')).toBeInTheDocument()
    expect(document.querySelector('.admin-auth__row-value--ok')).toBeInTheDocument()
    expect(sawAuthHeader).toBe(false)
    expect(screen.queryByText(/no key required/)).not.toBeInTheDocument()
  })

  it('derives auth.enabled = false (red) with a warning from a 200 on the headerless probe', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
    )
    await act(() => connect(makeConnection()))
    renderAuthCard()

    expect(await screen.findByText('false')).toBeInTheDocument()
    expect(document.querySelector('.admin-auth__row-value--err')).toBeInTheDocument()
    expect(screen.getByText(/no key required/)).toBeInTheDocument()
  })

  it('always shows the static scheme and the toml explanatory note', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => new HttpResponse(null, { status: 401 })),
    )
    await act(() => connect(makeConnection()))
    renderAuthCard()

    expect(screen.getByText('bearer api-key')).toBeInTheDocument()
    expect(await screen.findByText(/admins live in luradb\.toml/)).toBeInTheDocument()
  })
})
