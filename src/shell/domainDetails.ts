import { queryOptions } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'

type TableSummary = components['schemas']['TableSummary']
type ViewSummary = components['schemas']['ViewSummary']
type TableDetail = components['schemas']['TableDetail']
type JsonDomainDetail = components['schemas']['JsonDomainResponse']
type IndexResponse = components['schemas']['IndexResponse']

/** Detail-Queries der expandierten Domäne (spec shell/002 §3/§5) — nur aktiv, wenn `enabled` (Domäne expandiert + Engine vorhanden). */
export function relTablesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['rel-tables', domain] as const,
    queryFn: async (): Promise<TableSummary[]> => {
      if (!apiClient) throw new Error('rel tables query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/tables', { params: { path: { domain } } })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load tables')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export function relViewsQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['rel-views', domain] as const,
    queryFn: async (): Promise<ViewSummary[]> => {
      if (!apiClient) throw new Error('rel views query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/{domain}/views', { params: { path: { domain } } })
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
    queryFn: async (): Promise<JsonDomainDetail> => {
      if (!apiClient) throw new Error('json domain detail query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/domains/{name}', { params: { path: { name: domain } } })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load json domain detail')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

export function jsonIndexesQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['json-indexes', domain] as const,
    queryFn: async (): Promise<IndexResponse[]> => {
      if (!apiClient) throw new Error('json indexes query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/{domain}/indexes', { params: { path: { domain } } })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load indexes')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}

/**
 * Stiller Key-Scan für die Aktivitäts-Ableitung (spec shell/004 §1) — kein `withCall`, da Explorer-Detail-Queries
 * nicht durch den Recorder laufen; der KV-Browser (data/002) nutzt für seine Anzeige einen eigenen recorded Scan
 * (kvEntries.ts). Kein `limit`/`count` im Contract (Backlog server-repo) — voller Scan ist die Zwischenlösung.
 */
export function kvKeysProbeQueryOptions(apiClient: ApiClient | undefined, domain: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['kv-keys-probe', domain] as const,
    queryFn: async (): Promise<string[]> => {
      if (!apiClient) throw new Error('kv keys probe query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/kv/{domain}/keys', { params: { path: { domain } } })
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load keys')
      return data
    },
    enabled: enabled && apiClient !== undefined,
  })
}
