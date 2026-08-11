import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect } from '../app/session'
import { resetDocsState, useDocsState } from '../screens/docs/docsStore'
import { server } from '../test/msw'
import { CommandPaletteContent } from './CommandPalette'
import { SelectedDomainProvider, useSelectedDomain } from './SelectedDomainContext'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function RouteProbe() {
  const location = useLocation()
  return (
    <p data-testid="route-state">
      {location.pathname}
      {location.search}
    </p>
  )
}

function SelectedProbe() {
  const { selected } = useSelectedDomain()
  return <p data-testid="selected-domain">{selected ?? ''}</p>
}

function DocsProbe() {
  const { tabs, activeId } = useDocsState()
  return (
    <p data-testid="docs-state">
      {activeId ?? ''}·{tabs.join(',')}
    </p>
  )
}

function Harness({ onClose }: { onClose: () => void }) {
  return (
    <SelectedDomainProvider>
      <CommandPaletteContent onClose={onClose} />
      <RouteProbe />
      <SelectedProbe />
      <DocsProbe />
    </SelectedDomainProvider>
  )
}

async function renderConnectedPalette(onClose: () => void = () => {}) {
  server.use(
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () =>
      HttpResponse.json([
        { name: 'analytics', created_at: 1, state: 'active' },
        { name: 'shop', created_at: 1, state: 'active' },
      ]),
    ),
  )
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/engines']}>
        <Harness onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('shop')
  return result
}

function renderDisconnectedPalette(onClose: () => void = () => {}) {
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/engines']}>
        <Harness onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
  resetDocsState()
})

describe('CommandPaletteContent', () => {
  it('Enter without arrow keys runs the first entry (a screen) and closes the palette', async () => {
    const onClose = vi.fn()
    await renderConnectedPalette(onClose)

    fireEvent.keyDown(screen.getByLabelText('command palette search'), { key: 'Enter' })

    expect(screen.getByTestId('route-state').textContent).toBe('/sql')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown crosses from SCREENS into DOMAINS, and Enter selects the domain and navigates using its highest-priority engine (rel)', async () => {
    const onClose = vi.fn()
    await renderConnectedPalette(onClose)
    const input = screen.getByLabelText('command palette search')

    // 7 Screens (Rail-Ziele) + "analytics" (alphabetisch erste Domäne, zugleich der Auto-Default der Explorer-Auswahl)
    // davor — Index 8 ist "shop", damit der Test die Auswahl tatsächlich ändert statt den Default zu bestätigen.
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('route-state').textContent).toBe('/data?engine=rel')
    expect(screen.getByTestId('selected-domain').textContent).toBe('shop')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('typing narrows the list, and a mouse click on a doc hit opens it and navigates to /docs', async () => {
    const onClose = vi.fn()
    await renderConnectedPalette(onClose)
    const input = screen.getByLabelText('command palette search')

    // Leere Eingabe zeigt keine Docs — erst nach Eingabe erscheint der Treffer (spec §2).
    expect(screen.queryByText('Export today, scheduled backup on the roadmap')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'backup' } })

    expect(screen.queryByText('shop')).not.toBeInTheDocument()
    const docRow = await screen.findByText('Export today, scheduled backup on the roadmap')
    fireEvent.click(docRow)

    expect(screen.getByTestId('route-state').textContent).toBe('/docs')
    expect(screen.getByTestId('docs-state').textContent).toBe('backup-restore·backup-restore')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the palette', async () => {
    const onClose = vi.fn()
    await renderConnectedPalette(onClose)

    fireEvent.keyDown(screen.getByLabelText('command palette search'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('without an active session, DOMAINS shows a silent "connect to browse domains" row instead of fetching', () => {
    renderDisconnectedPalette()

    expect(screen.getByText('connect to browse domains')).toBeInTheDocument()
    expect(screen.getByText('connect to browse domains').closest('button')).toBeNull()
  })
})
