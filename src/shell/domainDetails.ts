import { queryOptions, type QueryFunctionContext } from '@tanstack/react-query'
import { ApiError, retryAfterSecs, type ApiClient } from '../api'
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

/** An engine is switched off for a domain when one of its queries fails with 503 on first load; a 503 after a success or with Retry-After (overload) does not count. */
export function isEngineOff(queries: EngineQueryState[]): boolean {
  return queries.some(
    (query) =>
      query.isLoadingError && query.error instanceof ApiError && query.error.status === 503 && query.error.retryAfterSecs === undefined,
  )
}

/** pollSilentRecord, plus silent after a failed attempt (a switched-off engine answers 503 on every tick). `errorUpdatedAt`, not `error`: a refetch without data clears `error` before the query function runs. */
function engineSilentRecord(context: Pick<QueryFunctionContext, 'client' | 'queryKey'>): boolean {
  return pollSilentRecord(context) || (context.client.getQueryState(context.queryKey)?.errorUpdatedAt ?? 0) > 0
}

export const REL_TABLES_PREFIX = ['rel-tables'] as const

export function relTablesKey(domain: string) {
  return [...REL_TABLES_PREFIX, domain] as const
}

/** Detail queries of a domain; active only when `enabled`. */
export function relTablesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: relTablesKey(domain),
    queryFn: async (context): Promise<TableSummary[]> => {
      if (!apiClient) throw new Error('rel tables query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/tables', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load tables', undefined, retryAfterSecs(response))
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export const REL_VIEWS_PREFIX = ['rel-views'] as const

export function relViewsKey(domain: string) {
  return [...REL_VIEWS_PREFIX, domain] as const
}

export function relViewsQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: relViewsKey(domain),
    queryFn: async (context): Promise<ViewSummary[]> => {
      if (!apiClient) throw new Error('rel views query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/views', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load views', undefined, retryAfterSecs(response))
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

/** Detail (columns) of a single table, cached per (domain, table) and shared by the REL section and the links panel. */
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

export function jsonCountKey(domain: string) {
  return ['json-count', domain] as const
}

export function jsonDocumentCountQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: jsonCountKey(domain),
    queryFn: async (context): Promise<number> => {
      if (!apiClient) throw new Error('json count query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/{domain}/documents/count', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to count documents', undefined, retryAfterSecs(response))
      return data.count
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export const JSON_INDEXES_PREFIX = ['json-indexes'] as const

export function jsonIndexesKey(domain: string) {
  return [...JSON_INDEXES_PREFIX, domain] as const
}

export function jsonIndexesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: jsonIndexesKey(domain),
    queryFn: async (context): Promise<IndexResponse[]> => {
      if (!apiClient) throw new Error('json indexes query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/{domain}/indexes', {
        params: { path: { domain } },
        silentRecord: engineSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load indexes', undefined, retryAfterSecs(response))
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export function kvCountKey(domain: string) {
  return ['kv-count', domain] as const
}

/**
 * Domain key counter for deriving activity, via `GET …/kv/{domain}/count` (contract 0.6.1);
 * no `prefix`, no key transfer. First load is recorded, follow-up ticks are silent;
 * the KV browser uses its own recorded scan (kvEntries.ts).
 */
export function kvKeyCountQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: kvCountKey(domain),
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

const REL_TABLE_COUNT_PREFIX = ['rel-table-count'] as const

export function relTableCountDomainPrefix(domain: string) {
  return [...REL_TABLE_COUNT_PREFIX, domain] as const
}

export function relTableCountKey(domain: string, table: string) {
  return [...REL_TABLE_COUNT_PREFIX, domain, table] as const
}

/** Row count per table; only the table rows of the expanded domain hold this query. */
export function relTableRowCountQueryOptions(apiClient: ApiClient | undefined, domain: string, table: string) {
  return queryOptions({
    queryKey: relTableCountKey(domain, table),
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
