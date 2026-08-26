import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient, type CallInfo } from '../../api'
import { createAppQueryClient } from '../../app/queryClient'
import { server } from '../../test/msw'
import { healthQueryOptions } from './health'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApiClient(): ApiClient {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

describe('healthQueryOptions recorder behaviour (general/012)', () => {
  it('records the first load (Erst-Load), then stays silent on a refetch once the query already has cached data', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/health`, () => {
        requests += 1
        return HttpResponse.json({ uptime_secs: 10, domain_count: 1, estimated_memtable_keys: 2, l0_sstable_count: 0, vlog_size_bytes: 0 })
      }),
    )
    const apiClient = makeApiClient()
    const calls: CallInfo[] = []
    apiClient.onCall((info) => calls.push(info))
    const queryClient = createAppQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useQuery(healthQueryOptions(apiClient)), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toBe(1)
    expect(calls).toHaveLength(1)

    await result.current.refetch()
    expect(requests).toBe(2)
    expect(calls).toHaveLength(1) // Folge-Tick blieb still
  })
})
