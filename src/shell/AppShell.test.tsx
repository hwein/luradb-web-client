import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { BrowserRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { BASE_PATH } from '../api'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect } from '../app/session'
import { server } from '../test/msw'
import { AppShell } from './AppShell'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

async function renderConnectedShell(path = '/sql'): Promise<void> {
  window.history.pushState({}, '', path)
  server.use(
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
    http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 4260 })),
  )
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  disconnect()
  window.history.pushState({}, '', '/')
})

describe('AppShell', () => {
  it('redirects / to the SQL screen', async () => {
    await renderConnectedShell('/')
    expect(await screen.findByText('run a query to see results')).toBeInTheDocument()
  })

  it('switches screens on rail clicks and marks the active route', async () => {
    await renderConnectedShell('/sql')
    await screen.findByText('run a query to see results')

    fireEvent.click(screen.getByTitle('Data browser'))

    // Keine Domänen in diesem Test-Setup ⇒ der Data-Browser zeigt seinen Leerzustand (spec data/001 §1).
    expect(await screen.findByText('no domain selected')).toBeInTheDocument()
    expect(screen.getByTitle('Data browser')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTitle('LuraSQL console')).not.toHaveAttribute('aria-current')
  })

  it('treats /admin/* as a nested container, redirects an unknown section to the index, and keeps the admin rail button active', async () => {
    await renderConnectedShell('/admin/anything')

    expect(await screen.findByPlaceholderText('new domain (max 50 chars)')).toBeInTheDocument()
    expect(screen.getByTitle('Admin')).toHaveAttribute('aria-current', 'page')
  })

  it('renders live connection details in the statusbar', async () => {
    await renderConnectedShell('/sql')
    await screen.findByText('run a query to see results')

    expect(await screen.findByText('bearer ✓ admin')).toBeInTheDocument()
    expect(await screen.findByText('luradb 0.1.0')).toBeInTheDocument()
    expect(await screen.findByText('up 1h 11m')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.host} ${BASE_PATH}`)).toBeInTheDocument()
    expect(screen.getByTitle('disconnect')).toHaveTextContent('connected')
  })

  it('F1 navigates to the docs screen and focuses its search field', async () => {
    await renderConnectedShell('/sql')
    await screen.findByText('run a query to see results')

    fireEvent.keyDown(window, { key: 'F1' })

    expect(await screen.findByLabelText('search docs')).toHaveFocus()
    expect(screen.getByTitle('Docs')).toHaveAttribute('aria-current', 'page')
  })

  it('toggles the theme via the rail pill', async () => {
    await renderConnectedShell('/sql')
    await screen.findByText('run a query to see results')

    const pill = screen.getByTitle('Toggle theme')
    expect(pill).toHaveTextContent('DARK')

    fireEvent.click(pill)

    expect(pill).toHaveTextContent('LIGHT')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
