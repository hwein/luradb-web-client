import { QueryClientProvider, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient, type CallInfo } from '../api'
import { createAppQueryClient } from '../app/queryClient'
import { server } from '../test/msw'
import { kvKeyCountQueryOptions, relTableRowCountQueryOptions } from './domainDetails'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApiClient(): ApiClient {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

/** Erst-Load aufgezeichnet, Folge-Tick still (general/012) — für beide Zähler dasselbe Muster. */
async function expectFirstLoadRecordedThenSilent<TKey extends readonly unknown[]>(
  apiClient: ApiClient,
  options: UseQueryOptions<number, Error, number, TKey>,
  requests: () => number,
): Promise<void> {
  const calls: CallInfo[] = []
  apiClient.onCall((info) => calls.push(info))
  const queryClient = createAppQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

  const { result } = renderHook(() => useQuery(options), { wrapper })

  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(requests()).toBe(1)
  expect(calls).toHaveLength(1)

  await result.current.refetch()
  expect(requests()).toBe(2)
  expect(calls).toHaveLength(1)
}

describe('kvKeyCountQueryOptions (spec shell/010 §1)', () => {
  it('keys by domain, calls GET …/kv/{domain}/count without a prefix and returns the count', async () => {
    let url: URL | undefined
    server.use(
      http.get(`${BASE_URL}/store-api/kv/shop/count`, ({ request }) => {
        url = new URL(request.url)
        return HttpResponse.json({ count: 1205 })
      }),
    )
    const options = kvKeyCountQueryOptions(makeApiClient(), 'shop', true)
    expect(options.queryKey).toEqual(['kv-count', 'shop'])

    const count = await createAppQueryClient().fetchQuery(options)

    expect(count).toBe(1205)
    expect(url?.searchParams.has('prefix')).toBe(false)
  })

  it('records the first load, then stays silent on a refetch', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/store-api/kv/shop/count`, () => {
        requests += 1
        return HttpResponse.json({ count: 2 })
      }),
    )
    const apiClient = makeApiClient()
    await expectFirstLoadRecordedThenSilent(apiClient, kvKeyCountQueryOptions(apiClient, 'shop', true), () => requests)
  })
})

describe('relTableRowCountQueryOptions (spec shell/010 §4)', () => {
  it('keys by domain and table and returns the count from GET …/tables/{table}/count', async () => {
    server.use(http.get(`${BASE_URL}/store-api/rel/shop/tables/orders/count`, () => HttpResponse.json({ count: 12400 })))
    const options = relTableRowCountQueryOptions(makeApiClient(), 'shop', 'orders', true)
    expect(options.queryKey).toEqual(['rel-table-count', 'shop', 'orders'])

    await expect(createAppQueryClient().fetchQuery(options)).resolves.toBe(12400)
  })

  it('records the first load, then stays silent on a refetch', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/store-api/rel/shop/tables/orders/count`, () => {
        requests += 1
        return HttpResponse.json({ count: 3 })
      }),
    )
    const apiClient = makeApiClient()
    await expectFirstLoadRecordedThenSilent(apiClient, relTableRowCountQueryOptions(apiClient, 'shop', 'orders', true), () => requests)
  })
})
