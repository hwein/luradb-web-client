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

function renderHealth() {
  const queryClient = createAppQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return renderHook(() => useQuery({ ...healthQueryOptions(makeApiClient()), retry: false }), { wrapper })
}

describe('healthQueryOptions snapshot', () => {
  it('parses status, shards, resources, io and version from a 200', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, () =>
        HttpResponse.json({
          status: 'ok',
          version: '0.7.1',
          shards: [{ id: 0, status: 'ok' }],
          resources: { state: 'ok', disk_state: 'ok', memory_state: 'ok' },
          io: { failures: 2 },
        }),
      ),
    )
    const { result } = renderHealth()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({
      status: 'ok',
      version: '0.7.1',
      shards: [{ id: '0', status: 'ok' }],
      resources: { state: 'ok', diskState: 'ok', memoryState: 'ok' },
      ioFailures: 2,
    })
  })

  it('reads a 503 body as a snapshot', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, () =>
        HttpResponse.json(
          { status: 'degraded', shards: [{ id: 1, status: 'timeout' }], resources: { state: 'blocked', disk_state: 'blocked', memory_state: 'ok' }, io: null },
          { status: 503 },
        ),
      ),
    )
    const { result } = renderHealth()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({
      status: 'degraded',
      shards: [{ id: '1', status: 'timeout' }],
      resources: { state: 'blocked', diskState: 'blocked', memoryState: 'ok' },
      ioFailures: 0,
    })
  })

  it('keeps a 503 without body as an error', async () => {
    server.use(http.get(`${BASE_URL}/health`, () => new HttpResponse('503 Service Unavailable', { status: 503 })))
    const { result } = renderHealth()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('falls back to degraded on an unknown status', async () => {
    server.use(http.get(`${BASE_URL}/health`, () => HttpResponse.json({ status: 'weird' })))
    const { result } = renderHealth()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.status).toBe('degraded')
  })

  it('falls back to warning on an unknown resource state', async () => {
    server.use(http.get(`${BASE_URL}/health`, () => HttpResponse.json({ status: 'ok', resources: { state: 'odd', disk_state: 'ok', memory_state: 'blocked' } })))
    const { result } = renderHealth()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.resources).toEqual({ state: 'warning', diskState: 'ok', memoryState: 'blocked' })
  })

  it('defaults to an empty shard list, ok io and warning resources when fields are missing', async () => {
    server.use(http.get(`${BASE_URL}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 3 })))
    const { result } = renderHealth()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ shards: [], ioFailures: 0, resources: { state: 'warning', diskState: 'warning', memoryState: 'warning' } })
  })
})

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
