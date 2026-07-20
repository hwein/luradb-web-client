import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { DomainsCard } from './DomainsCard'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function ConnectedDomainsCard() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <DomainsCard apiClient={apiClient} />
}

function renderConnected() {
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedDomainsCard />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
})

describe('DomainsCard', () => {
  it('renders engine dots based on activity (contains objects), not registry presence, and only the JSON document_count as an object number', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () =>
        HttpResponse.json([
          { name: 'shop', created_at: 1 },
          { name: 'sessions', created_at: 2 },
        ]),
      ),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
      http.get(`${ORIGIN}/store-api/json/domains/shop`, () =>
        HttpResponse.json({ name: 'shop', created_at: 1, state: 'active', document_count: 52123 }),
      ),
      http.get(`${ORIGIN}/store-api/json/shop/indexes`, () => HttpResponse.json([])),
      // shop steht per Anlage-Kaskade (shell/003) auch in der rel-Registry, hat aber noch keine Tabellen/Views -> kein rel-Dot.
      http.get(`${ORIGIN}/store-api/rel/shop/tables`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/shop/views`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/kv/shop/keys`, () => HttpResponse.json(['k1'])),
      http.get(`${ORIGIN}/store-api/kv/sessions/keys`, () => HttpResponse.json(['s1'])),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await waitFor(() => {
      const shopRow = screen.getByText('shop').closest('.admin-domains__row')
      expect(shopRow?.querySelector('.admin-domains__dot--json')).toBeInTheDocument()
      expect(shopRow?.querySelector('.admin-domains__dot--kv')).toBeInTheDocument()
      expect(shopRow?.querySelector('.admin-domains__dot--rel')).not.toBeInTheDocument()
      expect(screen.getByText('52.1k objects')).toBeInTheDocument()
    })

    const sessionsRow = screen.getByText('sessions').closest('.admin-domains__row')
    await waitFor(() => expect(sessionsRow?.querySelector('.admin-domains__dot--kv')).toBeInTheDocument())
    expect(sessionsRow?.querySelector('.admin-domains__dot--json')).not.toBeInTheDocument()
    expect(sessionsRow?.textContent).not.toContain('objects')
  })

  it('shows no dots for a domain registered in all three engines but holding no objects yet', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'fresh', created_at: 1 }])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'fresh', created_at: 1, state: 'active' }])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([{ name: 'fresh', created_at: 1, state: 'active' }])),
      http.get(`${ORIGIN}/store-api/json/domains/fresh`, () =>
        HttpResponse.json({ name: 'fresh', created_at: 1, state: 'active', document_count: 0 }),
      ),
      http.get(`${ORIGIN}/store-api/json/fresh/indexes`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/fresh/tables`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/fresh/views`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/kv/fresh/keys`, () => HttpResponse.json([])),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    // "0 objects" beweist, dass die Detail-Query settled ist (document_count: 0 ist eine gültige Zahl) -> die
    // Dot-Abwesenheit lässt sich erst ab diesem Zeitpunkt verlässlich prüfen.
    await waitFor(() => {
      expect(screen.getByText('0 objects')).toBeInTheDocument()
      const freshRow = screen.getByText('fresh').closest('.admin-domains__row')
      expect(freshRow?.querySelector('.admin-domains__dot')).not.toBeInTheDocument()
    })
  })

  it('renders a domain flagged deleting (by any engine) as a muted row', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'old', created_at: 1, state: 'deleting' }])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/json/domains/old`, () =>
        HttpResponse.json({ name: 'old', created_at: 1, state: 'deleting', document_count: 0 }),
      ),
      http.get(`${ORIGIN}/store-api/json/old/indexes`, () => HttpResponse.json([])),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const name = await screen.findByText('old')
    expect(name.closest('.admin-domains__row')).toHaveClass('admin-domains__row--muted')
  })

  it('arms, confirms, and deletes across every engine the domain has; a partial failure lists inline per engine', async () => {
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1 }])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
      http.get(`${ORIGIN}/store-api/json/domains/shop`, () =>
        HttpResponse.json({ name: 'shop', created_at: 1, state: 'active', document_count: 3 }),
      ),
      http.get(`${ORIGIN}/store-api/json/shop/indexes`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/shop/tables`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/shop/views`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/kv/shop/keys`, () => HttpResponse.json([])),
      http.delete(`${ORIGIN}/store-api/domains/shop`, () => new HttpResponse(null, { status: 202 })),
      http.delete(`${ORIGIN}/store-api/json/domains/shop`, () => new HttpResponse(null, { status: 202 })),
      http.delete(`${ORIGIN}/store-api/rel/domains/shop`, () => new HttpResponse(null, { status: 500 })),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('shop')
    fireEvent.click(screen.getByTitle('delete domain'))
    expect(await screen.findByText(/delete "shop" from kv\+json\+rel\?/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }))

    expect(await screen.findByText(/rel: 500/)).toBeInTheDocument()
    // Nicht alle Engines erfolgreich ⇒ confirm bleibt für einen Retry sichtbar.
    expect(screen.getByRole('button', { name: 'confirm' })).toBeInTheDocument()
  })

  it('cancel collapses the confirm inline without calling DELETE', async () => {
    let deleteCalled = false
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1 }])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/kv/shop/keys`, () => HttpResponse.json([])),
      http.delete(`${ORIGIN}/store-api/domains/shop`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 202 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('shop')
    fireEvent.click(screen.getByTitle('delete domain'))
    fireEvent.click(await screen.findByRole('button', { name: 'cancel' }))

    expect(screen.queryByText(/delete "shop"/)).not.toBeInTheDocument()
    expect(deleteCalled).toBe(false)
  })

  it('creates a domain across all three engines (no checkboxes), showing a 409 inline without losing the typed name', async () => {
    let kvCreateCalls = 0
    let jsonCreateCalls = 0
    let relCreateCalls = 0
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
      http.post(`${ORIGIN}/store-api/domains`, () => {
        kvCreateCalls += 1
        return HttpResponse.json({ name: 'fresh', created_at: 1 }, { status: 201 })
      }),
      http.post(`${ORIGIN}/store-api/json/domains`, () => {
        jsonCreateCalls += 1
        return new HttpResponse(null, { status: 409 })
      }),
      http.post(`${ORIGIN}/store-api/rel/domains`, () => {
        relCreateCalls += 1
        return HttpResponse.json({ name: 'fresh', created_at: 1, state: 'active' }, { status: 201 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('new domain (max 50 chars)'), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/json: 409/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('new domain (max 50 chars)')).toHaveValue('fresh')
    expect(kvCreateCalls).toBe(1)
    expect(jsonCreateCalls).toBe(1)
    expect(relCreateCalls).toBe(1)
  })
})
