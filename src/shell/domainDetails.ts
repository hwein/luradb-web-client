import { queryOptions } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'
import { pollSilentRecord } from './pollSilentRecord'

type TableSummary = components['schemas']['TableSummary']
type ViewSummary = components['schemas']['ViewSummary']
type TableDetail = components['schemas']['TableDetail']
type JsonDomainDetail = components['schemas']['JsonDomainResponse']
type IndexResponse = components['schemas']['IndexResponse']

/** Detail-Queries der expandierten Domäne (spec shell/002 §3/§5) — nur aktiv, wenn `enabled` (Domäne expandiert + Engine vorhanden). */
export function relTablesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['rel-tables', domain] as const,
    queryFn: async (context): Promise<TableSummary[]> => {
      if (!apiClient) throw new Error('rel tables query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/tables', {
        params: { path: { domain } },
        silentRecord: pollSilentRecord(context),
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
        silentRecord: pollSilentRecord(context),
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

/** `document_count` steht nur am Detail-Endpunkt (nicht in der Liste) — eigene Query je expandierter Domäne. */
export function jsonDomainDetailQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['json-domain-detail', domain] as const,
    queryFn: async (context): Promise<JsonDomainDetail> => {
      if (!apiClient) throw new Error('json domain detail query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/domains/{name}', {
        params: { path: { name: domain } },
        silentRecord: pollSilentRecord(context),
      })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load json domain detail')
      return data
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
        silentRecord: pollSilentRecord(context),
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

/** Row-Count je Tabelle (spec shell/010 §4) — serverseitig ein O(n)-Key-Scan, daher nur für die expandierte Domäne und im 60s-Takt. */
export function relTableRowCountQueryOptions(apiClient: ApiClient | undefined, domain: string, table: string, enabled: boolean) {
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
    enabled: enabled && apiClient !== undefined,
  })
}
