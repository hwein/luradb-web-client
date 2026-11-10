import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { domainResponse, server } from '../../test/msw'
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

/** Empty answers for the per-engine probes of every domain; a test's own handlers are registered later and win. */
beforeEach(() => {
  server.use(
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
    http.get(`${ORIGIN}/store-api/rel/:domain/tables`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/:domain/views`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/:domain/documents/count`, () => HttpResponse.json({ count: 0 })),
    http.get(`${ORIGIN}/store-api/json/:domain/indexes`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/kv/:domain/count`, () => HttpResponse.json({ count: 0 })),
  )
})

afterEach(() => {
  act(() => disconnect())
})

describe('DomainsCard', () => {
  it('renders engine dots based on activity (contains objects) and the object count summed across all engines (nachtrag admin/001)', async () => {
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse('shop'), domainResponse('sessions')])),
      http.get(`${ORIGIN}/store-api/json/shop/documents/count`, () => HttpResponse.json({ count: 52123 })),
      http.get(`${ORIGIN}/store-api/kv/shop/count`, () => HttpResponse.json({ count: 1 })),
      http.get(`${ORIGIN}/store-api/kv/sessions/count`, () => HttpResponse.json({ count: 1 })),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await waitFor(() => {
      const shopRow = screen.getByText('shop').closest('.admin-domains__row')
      expect(shopRow?.querySelector('.admin-domains__dot--json')).toBeInTheDocument()
      expect(shopRow?.querySelector('.admin-domains__dot--kv')).toBeInTheDocument()
      expect(shopRow?.querySelector('.admin-domains__dot--rel')).not.toBeInTheDocument()
      // 52123 documents + 1 kv key -> 52.1k summed across all engines.
      expect(screen.getByText('52.1k objects')).toBeInTheDocument()
    })

    const sessionsRow = screen.getByText('sessions').closest('.admin-domains__row')
    await waitFor(() => expect(sessionsRow?.querySelector('.admin-domains__dot--kv')).toBeInTheDocument())
    expect(sessionsRow?.querySelector('.admin-domains__dot--json')).not.toBeInTheDocument()
    await waitFor(() => expect(sessionsRow?.textContent).toContain('1 objects'))
  })

  it('shows no dots for a domain holding no objects yet', async () => {
    server.use(http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse('fresh')])))
    await act(() => connect(makeConnection()))
    renderConnected()

    // "0 objects" proves that every activity source has settled (objectCount appears only then) -> only from
    // that point on the absence of dots can be checked reliably.
    await waitFor(() => {
      expect(screen.getByText('0 objects')).toBeInTheDocument()
      const freshRow = screen.getByText('fresh').closest('.admin-domains__row')
      expect(freshRow?.querySelector('.admin-domains__dot')).not.toBeInTheDocument()
    })
  })

  it('deletes a domain with a single DELETE after the confirm step', async () => {
    const deletes: string[] = []
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json(deletes.length > 0 ? [] : [domainResponse('shop')])),
      http.delete(`${ORIGIN}/store-api/*`, ({ request }) => {
        deletes.push(new URL(request.url).pathname)
        return new HttpResponse(null, { status: 202 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('shop')
    fireEvent.click(screen.getByTitle('delete domain'))
    expect(await screen.findByText(/delete "shop" with its keys, documents, tables and views\?/)).toBeInTheDocument()
    expect(deletes).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }))

    await waitFor(() => expect(screen.queryByText('shop')).not.toBeInTheDocument())
    expect(deletes).toEqual(['/store-api/domains/shop'])
  })

  it('shows a failed delete as status and message and keeps the confirm step for a retry', async () => {
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse('shop')])),
      http.delete(`${ORIGIN}/store-api/domains/shop`, () => new HttpResponse(null, { status: 410 })),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('shop')
    fireEvent.click(screen.getByTitle('delete domain'))
    fireEvent.click(await screen.findByRole('button', { name: 'confirm' }))

    expect(await screen.findByText('410 already deleting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'confirm' })).toBeInTheDocument()
  })

  it('cancel collapses the confirm inline without calling DELETE', async () => {
    let deleteCalled = false
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse('shop')])),
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

  it('creates a domain with one POST (no checkboxes), showing a 409 inline without losing the typed name', async () => {
    let createCalls = 0
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
      http.post(`${ORIGIN}/store-api/domains`, () => {
        createCalls += 1
        return new HttpResponse(null, { status: 409 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('new domain (max 50 chars)'), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('409 domain already exists')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('new domain (max 50 chars)')).toHaveValue('fresh')
    expect(createCalls).toBe(1)
  })

  it('shows a collective error line when the domain list query failed (spec admin/005 §2)', async () => {
    server.use(http.get(`${ORIGIN}/store-api/domains`, () => new HttpResponse(null, { status: 500 })))
    await act(() => connect(makeConnection()))
    renderConnected()

    expect(await screen.findByText('domains unavailable — 500 domain list failed')).toBeInTheDocument()
  })
})
