import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient, type CallInfo } from '../api'
import { createAppQueryClient } from '../app/queryClient'
import { kvKeyScan, server } from '../test/msw'
import { kvKeysProbeQueryOptions } from './domainDetails'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApiClient(): ApiClient {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

describe('kvKeysProbeQueryOptions recorder behaviour (general/012)', () => {
  it('records the first load (Erst-Load), then stays silent on a refetch once the query already has cached data', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/store-api/kv/shop/keys`, () => {
        requests += 1
        return HttpResponse.json(kvKeyScan(['a', 'b']))
      }),
    )
    const apiClient = makeApiClient()
    const calls: CallInfo[] = []
    apiClient.onCall((info) => calls.push(info))
    const queryClient = createAppQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useQuery(kvKeysProbeQueryOptions(apiClient, 'shop', true)), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toBe(1)
    expect(calls).toHaveLength(1)

    await result.current.refetch()
    expect(requests).toBe(2)
    expect(calls).toHaveLength(1) // Folge-Tick blieb still
  })
})
