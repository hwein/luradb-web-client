import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient, type CallInfo } from '../api'
import { createAppQueryClient } from '../app/queryClient'
import { domainResponse, server } from '../test/msw'
import { createDomain, deleteDomain, domainsQueryOptions, useDomainsPending, useDomainSummaries } from './domains'

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
          {domain.conditionalWrites.join(',')}
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

describe('domainsQueryOptions', () => {
  it('polls every 30s so foreign changes to the domain list surface without user action (spec shell/007 §1)', () => {
    expect(domainsQueryOptions(undefined).refetchInterval).toBe(30_000)
  })

  it('records the first load (Erst-Load), then stays silent on a refetch once the query already has cached data', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, () => {
        requests += 1
        return HttpResponse.json([])
      }),
    )
    const apiClient = makeApiClient()
    const calls: CallInfo[] = []
    apiClient.onCall((info) => calls.push(info))
    const queryClient = createAppQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useQuery(domainsQueryOptions(apiClient)), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toBe(1)
    expect(calls).toHaveLength(1)

    await result.current.refetch()
    expect(requests).toBe(2)
    expect(calls).toHaveLength(1) // Folge-Tick blieb still
  })
})

describe('useDomainSummaries', () => {
  it('lists domains from GET /store-api/domains, sorted alphabetically', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, () =>
        HttpResponse.json([
          domainResponse('shop'),
          domainResponse('audit', { require_conditional_writes: { kv: true, json: true } }),
          domainResponse('logs'),
        ]),
      ),
    )

    renderProbe(makeApiClient())

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.dataset.testid)).toEqual(['domain-audit', 'domain-logs', 'domain-shop'])
    expect(screen.getByTestId('domain-audit')).toHaveTextContent('kv,json')
    expect(screen.getByTestId('domain-shop')).toHaveTextContent('')
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
  it('is true until the domain list has settled, then false', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([])))

    renderPendingProbe(makeApiClient())

    expect(screen.getByTestId('pending')).toHaveTextContent('true')
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('false'))
  })

  it('stays pending forever without a connection — the disabled queries never settle, so the empty-state hint stays suppressed', () => {
    renderPendingProbe(undefined)

    expect(screen.getByTestId('pending')).toHaveTextContent('true')
  })
})

describe('createDomain', () => {
  it('creates a domain with one POST /store-api/domains', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${BASE_URL}/store-api/domains`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(domainResponse('shop'), { status: 201 })
      }),
    )

    await expect(createDomain(makeApiClient(), 'shop')).resolves.toBeUndefined()
    expect(bodies).toEqual([{ name: 'shop' }])
  })

  it('throws an ApiError with a dedicated message on 409', async () => {
    server.use(http.post(`${BASE_URL}/store-api/domains`, () => new HttpResponse(null, { status: 409 })))
    await expect(createDomain(makeApiClient(), 'shop')).rejects.toMatchObject({ status: 409, message: 'domain already exists' })
  })

  it('throws an ApiError carrying the status on other failures', async () => {
    server.use(http.post(`${BASE_URL}/store-api/domains`, () => new HttpResponse(null, { status: 400 })))
    await expect(createDomain(makeApiClient(), 'bad name')).rejects.toMatchObject({ status: 400 })
  })
})

describe('deleteDomain', () => {
  it('deletes a domain with one DELETE /store-api/domains/{name}', async () => {
    const paths: string[] = []
    server.use(
      http.delete(`${BASE_URL}/store-api/domains/:name`, ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return new HttpResponse(null, { status: 202 })
      }),
    )

    await expect(deleteDomain(makeApiClient(), 'shop')).resolves.toBeUndefined()
    expect(paths).toEqual(['/store-api/domains/shop'])
  })
})
