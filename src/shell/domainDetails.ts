import { queryOptions, type QueryFunctionContext } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'
import { pollSilentRecord } from './pollSilentRecord'

type TableSummary = components['schemas']['TableSummary']
type ViewSummary = components['schemas']['ViewSummary']
type TableDetail = components['schemas']['TableDetail']
type IndexResponse = components['schemas']['IndexResponse']

interface EngineQueryState {
  isLoadingError: boolean
  error: unknown
}

/** An engine is switched off for a domain when one of its queries fails with 503 on first load; a 503 after a success (overload) does not count. */
export function isEngineOff(queries: EngineQueryState[]): boolean {
  return queries.some((query) => query.isLoadingError && query.error instanceof ApiError && query.error.status === 503)
}

/** pollSilentRecord, plus silent after a failed attempt (a switched-off engine answers 503 on every tick). `errorUpdatedAt`, not `error`: a refetch without data clears `error` before the query function runs. */
function engineSilentRecord(context: Pick<QueryFunctionContext, 'client' | 'queryKey'>): boolean {
  return pollSilentRecord(context) || (context.client.getQueryState(context.queryKey)?.errorUpdatedAt ?? 0) > 0
}

/** Detail queries of a domain (spec shell/002 §3/§5) — active only when `enabled`. */
export function relTablesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['rel-tables', domain] as const,
    queryFn: async (context): Promise<TableSummary[]> => {
      if (!apiClient) throw new Error('rel tables query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/tables', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load tables')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export function relViewsQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['rel-views', domain] as const,
    queryFn: async (context): Promise<ViewSummary[]> => {
      if (!apiClient) throw new Error('rel views query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/views', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load views')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

/** Tabellen-Detail (Spalten) einer einzelnen Tabelle — gecacht je (domain, table), gemeinsam genutzt von der REL-Sektion und dem Links-Panel. */
export function relTableDetailQueryOptions(apiClient: ApiClient | undefined, domain: string, table: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['rel-table-detail', domain, table] as const,
    queryFn: async (): Promise<TableDetail> => {
      if (!apiClient) throw new Error('rel table detail query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/tables/{table}', { params: { path: { domain, table } } })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load table detail')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export function jsonDocumentCountQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['json-count', domain] as const,
    queryFn: async (context): Promise<number> => {
      if (!apiClient) throw new Error('json count query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/{domain}/documents/count', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to count documents')
      return data.count
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export function jsonIndexesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['json-indexes', domain] as const,
    queryFn: async (context): Promise<IndexResponse[]> => {
      if (!apiClient) throw new Error('json indexes query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/{domain}/indexes', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load indexes')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

/**
 * Domänen-Key-Zähler für die Aktivitäts-Ableitung (spec shell/004 §1) über `GET …/kv/{domain}/count` (Contract 0.6.1,
 * spec shell/010 §1) — ohne `prefix`, ohne Key-Transfer. Erst-Load aufgezeichnet, Folge-Ticks still (general/012);
 * der KV-Browser (data/002) nutzt einen eigenen recorded Scan (kvEntries.ts).
 */
export function kvKeyCountQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['kv-count', domain] as const,
    queryFn: async (context): Promise<number> => {
      if (!apiClient) throw new Error('kv count query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/kv/{domain}/count', {
        params: { path: { domain } },
        silentRecord: pollSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to count keys')
      return data.count
    },
    enabled: enabled && apiClient !== undefined,
  })
}

/** Row-Count je Tabelle (spec shell/010 §4) — nur die Tabellenzeilen der expandierten Domäne halten diese Query. */
export function relTableRowCountQueryOptions(apiClient: ApiClient | undefined, domain: string, table: string) {
  return queryOptions({
    queryKey: ['rel-table-count', domain, table] as const,
    queryFn: async (context): Promise<number> => {
      if (!apiClient) throw new Error('rel table count query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/tables/{table}/count', {
        params: { path: { domain, table } },
        silentRecord: pollSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to count rows')
      return data.count
    },
    enabled: apiClient !== undefined,
  })
}
