import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createApi, type ApiClient, type CallInfo } from '../../api'
import { createAppQueryClient } from '../../app/queryClient'
import { server } from '../../test/msw'
import { backupsQueryOptions, restoreStatusQueryOptions } from './backups'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApiClient(): ApiClient {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

function makeWrapper(queryClient: ReturnType<typeof createAppQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('backupsQueryOptions recorder behaviour (general/012)', () => {
  it('records the first load and an idle refetch, but silences a tick while a job is already known to be running', async () => {
    let requests = 0
    let running: { id: string; scope: string; started_at: number } | null = null
    server.use(
      http.get(`${BASE_URL}/store-api/backups`, () => {
        requests += 1
        return HttpResponse.json({ backups: [], running })
      }),
    )
    const apiClient = makeApiClient()
    const calls: CallInfo[] = []
    apiClient.onCall((info) => calls.push(info))
    const queryClient = createAppQueryClient()

    const { result } = renderHook(() => useQuery(backupsQueryOptions(apiClient, false)), { wrapper: makeWrapper(queryClient) })

    // Erst-Load (Karten-Mount) — sichtbar.
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toBe(1)
    expect(calls).toHaveLength(1)

    // Refetch im Leerlauf (z. B. Invalidierung nach einer Mutation) — der Cache zeigt noch keinen laufenden Job,
    // bleibt also sichtbar statt pauschal still zu werden (spec §3: "nur die Intervall-Ticks").
    await result.current.refetch()
    expect(requests).toBe(2)
    expect(calls).toHaveLength(2)

    // Ein Job ist jetzt bekanntermaßen aktiv (voriger Fetch lieferte running !== null) — der nächste Tick
    // ist ein reiner Intervall-Poll und bleibt still.
    running = { id: 'run_1', scope: 'all', started_at: 0 }
    await result.current.refetch()
    expect(requests).toBe(3)
    expect(calls).toHaveLength(3)

    await result.current.refetch()
    expect(requests).toBe(4)
    expect(calls).toHaveLength(3) // weiterhin 3 — der 4. Call blieb still
  })
})

describe('restoreStatusQueryOptions recorder behaviour (general/012)', () => {
  it('records the first load, then stays silent once the query already has cached data', async () => {
    let requests = 0
    server.use(
      http.get(`${BASE_URL}/store-api/restores/restore_1`, () => {
        requests += 1
        return HttpResponse.json({
          backup_id: 'b1',
          restore_id: 'restore_1',
          state: 'running',
          imported: 0,
          skipped: 0,
          failed: 0,
          started_at: 0,
          errors: [],
        })
      }),
    )
    const apiClient = makeApiClient()
    const calls: CallInfo[] = []
    apiClient.onCall((info) => calls.push(info))
    const queryClient = createAppQueryClient()

    const { result } = renderHook(() => useQuery(restoreStatusQueryOptions(apiClient, 'restore_1')), {
      wrapper: makeWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toBe(1)
    expect(calls).toHaveLength(1)

    await result.current.refetch()
    expect(requests).toBe(2)
    expect(calls).toHaveLength(1) // Folge-Tick blieb still
  })
})
