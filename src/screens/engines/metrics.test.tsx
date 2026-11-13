import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient, type CallInfo } from '../../api'
import { createAppQueryClient } from '../../app/queryClient'
import { server } from '../../test/msw'
import { metricsQueryOptions } from './metrics'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApiClient(): ApiClient {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

const SYSTEM = { compaction_runs: 3, janitor_runs: 5 }

const KV_BLOCK = {
  read_ops: 100,
  write_ops: 200,
  window_secs: 60,
  read_latency_us_p50: 5,
  read_latency_us_p95: 50,
  read_latency_us_p99: 50,
  write_latency_us_p50: 500,
  write_latency_us_p95: 500,
  write_latency_us_p99: 500,
}

async function fetchMetrics(body: JsonBodyType) {
  server.use(http.get(`${BASE_URL}/store-api/metrics`, () => HttpResponse.json(body)))
  return createAppQueryClient().fetchQuery(metricsQueryOptions(makeApiClient()))
}

describe('metricsQueryOptions engines block', () => {
  it('maps the engines block field by field and keeps latencies in µs', async () => {
    const snapshot = await fetchMetrics({ system: SYSTEM, engines: { kv: KV_BLOCK } })

    expect(snapshot.engines.kv).toEqual({
      readOps: 100,
      writeOps: 200,
      readLatencyUsP50: 5,
      readLatencyUsP95: 50,
      writeLatencyUsP50: 500,
      writeLatencyUsP95: 500,
      windowSecs: 60,
    })
  })

  it('returns no engine entries when the engines block is missing', async () => {
    const snapshot = await fetchMetrics({ system: SYSTEM })

    expect(snapshot.engines).toEqual({})
    expect(snapshot.system).toEqual({ compactionRuns: 3, janitorRuns: 5 })
  })

  it('keeps a missing engine undefined and defaults missing number fields to 0', async () => {
    const kv: Record<string, number> = { ...KV_BLOCK }
    delete kv.write_ops
    const snapshot = await fetchMetrics({ system: SYSTEM, engines: { kv } })

    expect(snapshot.engines.json).toBeUndefined()
    expect(snapshot.engines.rel).toBeUndefined()
    expect(snapshot.engines.kv?.writeOps).toBe(0)
  })

  it('falls back to a 60 s window when window_secs is 0 or missing', async () => {
    const json: Record<string, number> = { ...KV_BLOCK }
    delete json.window_secs
    const snapshot = await fetchMetrics({
      system: SYSTEM,
      engines: { kv: { ...KV_BLOCK, window_secs: 0 }, json },
    })

    expect(snapshot.engines.kv?.windowSecs).toBe(60)
    expect(snapshot.engines.json?.windowSecs).toBe(60)
  })
})

describe('metricsQueryOptions recorder behaviour (general/012)', () => {
  it('records the first load (Erst-Load), then stays silent on a refetch once the query already has cached data', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/store-api/metrics`, () => {
        requests += 1
        return HttpResponse.json({ system: { total_reads: 1, total_writes: 2, compaction_runs: 0, janitor_runs: 0, memtable_size_bytes: 0 } })
      }),
    )
    const apiClient = makeApiClient()
    const calls: CallInfo[] = []
    apiClient.onCall((info) => calls.push(info))
    const queryClient = createAppQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useQuery(metricsQueryOptions(apiClient)), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toBe(1)
    expect(calls).toHaveLength(1)

    await result.current.refetch()
    expect(requests).toBe(2)
    expect(calls).toHaveLength(1) // Folge-Tick blieb still
  })
})
