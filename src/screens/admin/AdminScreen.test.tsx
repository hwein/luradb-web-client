import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
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
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })),
    http.get(`${ORIGIN}/store-api/auth/users`, () => (adminOk ? HttpResponse.json([]) : new HttpResponse(null, { status: 403 }))),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/backups`, () => HttpResponse.json({ backups: [], running: null })),
    http.get(`${ORIGIN}/store-api/logs`, () => HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 })),
    http.get(`${ORIGIN}/store-api/logs/files`, () =>
      HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 }),
    ),
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

  it('renders the designed DOMAINS + AUTH + BACKUPS cards for an admin key', async () => {
    await renderAt('/admin', true)

    expect(await screen.findByPlaceholderText('new domain (max 50 chars)')).toBeInTheDocument()
    expect(screen.getByText('AUTH')).toBeInTheDocument()
    expect(screen.getByText('BACKUPS')).toBeInTheDocument()
  })

  it('redirects an unknown admin section to the index', async () => {
    await renderAt('/admin/nope', true)

    expect(await screen.findByPlaceholderText('new domain (max 50 chars)')).toBeInTheDocument()
  })

  it('shows "admin check failed" with the response detail instead of the role-gate hint on a probe 500 (spec admin/005 §3)', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })),
      http.get(`${ORIGIN}/store-api/auth/users`, () => new HttpResponse(null, { status: 500 })),
    )
    await act(() => connect(makeConnection()))
    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin/*" element={<AdminScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('admin check failed — unexpected response (HTTP 500)')).toBeInTheDocument()
    expect(screen.queryByText('admin role required — your key has per-domain permissions only')).not.toBeInTheDocument()
  })

  it('shows no gate text and no cards while the admin probe is still pending — no false "admin role required" flash (spec admin/005 §3)', async () => {
    let releaseProbe: (() => void) | undefined
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })),
      http.get(`${ORIGIN}/store-api/auth/users`, async () => {
        await new Promise<void>((resolve) => {
          releaseProbe = resolve
        })
        return HttpResponse.json([])
      }),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/backups`, () => HttpResponse.json({ backups: [], running: null })),
      http.get(`${ORIGIN}/store-api/logs`, () => HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 })),
      http.get(`${ORIGIN}/store-api/logs/files`, () =>
        HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 }),
      ),
    )
    await act(() => connect(makeConnection()))
    const queryClient = createAppQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin/*" element={<AdminScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(releaseProbe).toBeDefined())
    expect(screen.queryByText('admin role required — your key has per-domain permissions only')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('new domain (max 50 chars)')).not.toBeInTheDocument()

    releaseProbe?.()
    expect(await screen.findByPlaceholderText('new domain (max 50 chars)')).toBeInTheDocument()
  })
})
