import { useQueries } from '@tanstack/react-query'
import type { ApiClient } from '../../api'
import { jsonDomainDetailQueryOptions, jsonIndexesQueryOptions, relTablesQueryOptions, relViewsQueryOptions } from '../../shell/domainDetails'

export interface JsonEngineTotals {
  documentCount: number
  indexCount: number
  loaded: boolean
}

export interface RelEngineTotals {
  tableCount: number
  viewCount: number
  loaded: boolean
}

/**
 * Summiert `document_count`/Index-Anzahl über alle JSON-Domänen (spec engines/001 §3) via den
 * bestehenden Explorer-Query-Options — ein Cache mit shell/domainDetails.ts. Ein Fan-out-Query je
 * Domäne ist O(n); auf der lokalen Instanz mit wenigen Domänen akzeptabel (Orchestrator-Hinweis 3).
 */
export function useJsonEngineTotals(apiClient: ApiClient | undefined, domains: string[]): JsonEngineTotals {
  const detailQueries = useQueries({
    queries: domains.map((domain) => jsonDomainDetailQueryOptions(apiClient, domain, true)),
  })
  const indexQueries = useQueries({
    queries: domains.map((domain) => jsonIndexesQueryOptions(apiClient, domain, true)),
  })

  return {
    documentCount: detailQueries.reduce((sum, query) => sum + (query.data?.document_count ?? 0), 0),
    indexCount: indexQueries.reduce((sum, query) => sum + (query.data?.length ?? 0), 0),
    loaded: detailQueries.every((query) => query.isSuccess) && indexQueries.every((query) => query.isSuccess),
  }
}

/** Summiert Tabellen-/View-Anzahl über alle REL-Domänen (spec engines/001 §3) — selbes Fan-out-Muster wie oben. */
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
  }
}
