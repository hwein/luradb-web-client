import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { server } from '../../test/msw'
import { AdminScreen } from './AdminScreen'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function baseHandlers(adminOk: boolean) {
  return [
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
    http.get(`${ORIGIN}/store-api/auth/users`, () => (adminOk ? HttpResponse.json([]) : new HttpResponse(null, { status: 403 }))),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
  ]
}

async function renderAt(path: string, adminOk: boolean) {
  server.use(...baseHandlers(adminOk))
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/*" element={<AdminScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
})

describe('AdminScreen', () => {
  it('shows the role-gate hint instead of the cards when the key is not admin', async () => {
    await renderAt('/admin', false)

    expect(await screen.findByText('admin role required — your key has per-domain permissions only')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('new domain (max 50 chars)')).not.toBeInTheDocument()
  })

  it('renders the designed DOMAINS + AUTH cards for an admin key', async () => {
    await renderAt('/admin', true)

    expect(await screen.findByPlaceholderText('new domain (max 50 chars)')).toBeInTheDocument()
    expect(screen.getByText('AUTH')).toBeInTheDocument()
  })

  it('redirects an unknown admin section to the index', async () => {
    await renderAt('/admin/nope', true)

    expect(await screen.findByPlaceholderText('new domain (max 50 chars)')).toBeInTheDocument()
  })

  it('keeps the section subnav out of the DOM while only one section is registered', async () => {
    await renderAt('/admin', true)
    await screen.findByPlaceholderText('new domain (max 50 chars)')

    expect(document.querySelector('.admin__subnav')).not.toBeInTheDocument()
  })
})
