import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient } from '../api'
import { createAppQueryClient } from '../app/queryClient'
import { server } from '../test/msw'
import {
  createJsonDomain,
  createKvDomain,
  createRelDomain,
  jsonDomainsQueryOptions,
  kvDomainsQueryOptions,
  relDomainsQueryOptions,
  useDomainsPending,
  useDomainSummaries,
} from './domains'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApiClient(): ApiClient {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

function DomainsProbe({ apiClient }: { apiClient: ApiClient }) {
  const domains = useDomainSummaries(apiClient)
  return (
    <ul>
      {domains.map((domain) => (
        <li key={domain.name} data-testid={`domain-${domain.name}`}>
          {[domain.engines.kv && 'kv', domain.engines.json && `json:${domain.engines.json.state}`, domain.engines.rel && `rel:${domain.engines.rel.state}`]
            .filter(Boolean)
            .join(',')}
        </li>
      ))}
    </ul>
  )
}

function renderProbe(apiClient: ApiClient) {
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <DomainsProbe apiClient={apiClient} />
    </QueryClientProvider>,
  )
}

describe('kvDomainsQueryOptions / jsonDomainsQueryOptions / relDomainsQueryOptions', () => {
  it('poll every 30s so foreign changes to the domain lists surface without user action (spec shell/007 §1)', () => {
    expect(kvDomainsQueryOptions(undefined).refetchInterval).toBe(30_000)
    expect(jsonDomainsQueryOptions(undefined).refetchInterval).toBe(30_000)
    expect(relDomainsQueryOptions(undefined).refetchInterval).toBe(30_000)
  })
})

describe('useDomainSummaries', () => {
  it('unions domains present in one, two, or three engines, sorted alphabetically', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, () =>
        HttpResponse.json([
          { name: 'only-kv', created_at: 1 },
          { name: 'kv-json', created_at: 1 },
          { name: 'all-three', created_at: 1 },
        ]),
      ),
      http.get(`${BASE_URL}/store-api/json/domains`, () =>
        HttpResponse.json([
          { name: 'kv-json', created_at: 1, state: 'active' },
          { name: 'all-three', created_at: 1, state: 'active' },
        ]),
      ),
      http.get(`${BASE_URL}/store-api/rel/domains`, () => HttpResponse.json([{ name: 'all-three', created_at: 1, state: 'active' }])),
    )

    renderProbe(makeApiClient())

    await waitFor(() => expect(screen.getByTestId('domain-all-three')).toHaveTextContent('kv,json:active,rel:active'))
    expect(screen.getByTestId('domain-kv-json')).toHaveTextContent('kv,json:active')
    expect(screen.getByTestId('domain-only-kv')).toHaveTextContent('kv')

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.dataset.testid)).toEqual(['domain-all-three', 'domain-kv-json', 'domain-only-kv'])
  })

  it('treats an unreachable engine list as down and still unions the reachable ones', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1 }])),
      http.get(`${BASE_URL}/store-api/json/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
      http.get(`${BASE_URL}/store-api/rel/domains`, () => new HttpResponse(null, { status: 500 })),
    )

    renderProbe(makeApiClient())

    await waitFor(() => expect(screen.getByTestId('domain-shop')).toHaveTextContent('kv,json:active'))
    expect(screen.getByTestId('domain-shop')).not.toHaveTextContent('rel:')
  })
})

function DomainsPendingProbe({ apiClient }: { apiClient: ApiClient | undefined }) {
  const pending = useDomainsPending(apiClient)
  return <p data-testid="pending">{String(pending)}</p>
}

function renderPendingProbe(apiClient: ApiClient | undefined) {
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <DomainsPendingProbe apiClient={apiClient} />
    </QueryClientProvider>,
  )
}

describe('useDomainsPending', () => {
  it('is true until all three list queries have settled, then false', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([])),
      http.get(`${BASE_URL}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${BASE_URL}/store-api/rel/domains`, () => HttpResponse.json([])),
    )

    renderPendingProbe(makeApiClient())

    expect(screen.getByTestId('pending')).toHaveTextContent('true')
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('false'))
  })

  it('stays pending forever without a connection — the disabled queries never settle, so the empty-state hint stays suppressed', () => {
    renderPendingProbe(undefined)

    expect(screen.getByTestId('pending')).toHaveTextContent('true')
  })
})

describe('createKvDomain / createJsonDomain / createRelDomain', () => {
  it('resolves on success', async () => {
    server.use(http.post(`${BASE_URL}/store-api/domains`, () => HttpResponse.json({ name: 'shop', created_at: 1 }, { status: 201 })))
    await expect(createKvDomain(makeApiClient(), 'shop')).resolves.toBeUndefined()
  })

  it('throws an ApiError with a dedicated message on 409', async () => {
    server.use(http.post(`${BASE_URL}/store-api/json/domains`, () => new HttpResponse(null, { status: 409 })))
    await expect(createJsonDomain(makeApiClient(), 'shop')).rejects.toMatchObject({ status: 409, message: 'domain already exists' })
  })

  it('throws an ApiError carrying the status on other failures', async () => {
    server.use(http.post(`${BASE_URL}/store-api/rel/domains`, () => new HttpResponse(null, { status: 400 })))
    await expect(createRelDomain(makeApiClient(), 'bad name')).rejects.toMatchObject({ status: 400 })
  })
})
