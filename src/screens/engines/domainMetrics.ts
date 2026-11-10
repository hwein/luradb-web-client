import { useQueries } from '@tanstack/react-query'
import type { ApiClient } from '../../api'
import {
  isEngineOff,
  jsonDocumentCountQueryOptions,
  jsonIndexesQueryOptions,
  relTablesQueryOptions,
  relViewsQueryOptions,
} from '../../shell/domainDetails'

export interface JsonEngineTotals {
  documentCount: number
  indexCount: number
  loaded: boolean
  off: boolean
}

export interface RelEngineTotals {
  tableCount: number
  viewCount: number
  loaded: boolean
  off: boolean
}

/**
 * Sums document and index counts over all domains (spec engines/001 §3) via the Explorer's
 * query options — one cache with shell/domainDetails.ts. One fan-out query per domain is O(n).
 */
export function useJsonEngineTotals(apiClient: ApiClient | undefined, domains: string[]): JsonEngineTotals {
  const countQueries = useQueries({
    queries: domains.map((domain) => jsonDocumentCountQueryOptions(apiClient, domain, true)),
  })
  const indexQueries = useQueries({
    queries: domains.map((domain) => jsonIndexesQueryOptions(apiClient, domain, true)),
  })

  return {
    documentCount: countQueries.reduce((sum, query) => sum + (query.data ?? 0), 0),
    indexCount: indexQueries.reduce((sum, query) => sum + (query.data?.length ?? 0), 0),
    loaded: countQueries.every((query) => query.isSuccess) && indexQueries.every((query) => query.isSuccess),
    off: isEngineOff([...countQueries, ...indexQueries]),
  }
}

/** Sums table and view counts over all domains (spec engines/001 §3) — same fan-out pattern as above. */
export function useRelEngineTotals(apiClient: ApiClient | undefined, domains: string[]): RelEngineTotals {
  const tableQueries = useQueries({
    queries: domains.map((domain) => relTablesQueryOptions(apiClient, domain, true)),
  })
  const viewQueries = useQueries({
    queries: domains.map((domain) => relViewsQueryOptions(apiClient, domain, true)),
  })

  return {
    tableCount: tableQueries.reduce((sum, query) => sum + (query.data?.length ?? 0), 0),
    viewCount: viewQueries.reduce((sum, query) => sum + (query.data?.length ?? 0), 0),
    loaded: tableQueries.every((query) => query.isSuccess) && viewQueries.every((query) => query.isSuccess),
    off: isEngineOff([...tableQueries, ...viewQueries]),
  }
}
