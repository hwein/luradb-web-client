import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '../api'
import {
  isEngineOff,
  jsonDocumentCountQueryOptions,
  jsonIndexesQueryOptions,
  kvKeyCountQueryOptions,
  relTablesQueryOptions,
  relViewsQueryOptions,
} from './domainDetails'
import type { DomainSummary } from './domains'

export type EngineActivityLevel = 'pending' | 'empty' | 'active'

export interface EngineActivity {
  /** undefined: the engine is switched off for this domain (isEngineOff). */
  rel: EngineActivityLevel | undefined
  json: EngineActivityLevel | undefined
  kv: EngineActivityLevel
  kvKeyCount: number | undefined
  /** Object count over the engines not switched off; undefined until every source has settled (addendum admin/001). */
  objectCount: number | undefined
}

interface CountQuery {
  isSuccess: boolean
  count: number
}

/** 'active' = Summe > 0; 'empty' = alle Quellen settled bei 0; sonst (noch offen oder Fehler) 'pending' (spec shell/004 §1). */
function levelFromCounts(queries: CountQuery[]): EngineActivityLevel {
  if (!queries.every((query) => query.isSuccess)) return 'pending'
  const total = queries.reduce((sum, query) => sum + query.count, 0)
  return total > 0 ? 'active' : 'empty'
}

/**
 * Store activity per engine of the domain (spec shell/004 §1): "active" means "holds objects"
 * (rel: tables/views, json: documents/indexes, kv: keys). rel/json share their query keys with domainDetails.ts
 * (one cache across Explorer, ExpandedDomain and the admin DomainsCard); for kv this hook also returns the key
 * count from `GET …/kv/{domain}/count`.
 */
export function useEngineActivity(apiClient: ApiClient | undefined, domain: DomainSummary): EngineActivity {
  // 60s für Proben und Zähler — serverseitig je Count ein O(n)-Key-Scan (spec shell/010 §7); Listen pollen in ExpandedDomain mit 30s.
  const tablesQuery = useQuery({ ...relTablesQueryOptions(apiClient, domain.name, true), refetchInterval: 60_000 })
  const viewsQuery = useQuery({ ...relViewsQueryOptions(apiClient, domain.name, true), refetchInterval: 60_000 })
  const jsonCountQuery = useQuery({ ...jsonDocumentCountQueryOptions(apiClient, domain.name, true), refetchInterval: 60_000 })
  const indexesQuery = useQuery({ ...jsonIndexesQueryOptions(apiClient, domain.name, true), refetchInterval: 60_000 })
  const kvCountQuery = useQuery({ ...kvKeyCountQueryOptions(apiClient, domain.name, true), refetchInterval: 60_000 })

  const relCounts: CountQuery[] = [
    { isSuccess: tablesQuery.isSuccess, count: tablesQuery.data?.length ?? 0 },
    { isSuccess: viewsQuery.isSuccess, count: viewsQuery.data?.length ?? 0 },
  ]
  const jsonCounts: CountQuery[] = [
    { isSuccess: jsonCountQuery.isSuccess, count: jsonCountQuery.data ?? 0 },
    { isSuccess: indexesQuery.isSuccess, count: indexesQuery.data?.length ?? 0 },
  ]
  const kvCounts: CountQuery[] = [{ isSuccess: kvCountQuery.isSuccess, count: kvCountQuery.data ?? 0 }]

  const relOff = isEngineOff([tablesQuery, viewsQuery])
  const jsonOff = isEngineOff([jsonCountQuery, indexesQuery])
  const rel = relOff ? undefined : levelFromCounts(relCounts)
  const json = jsonOff ? undefined : levelFromCounts(jsonCounts)
  const kv = levelFromCounts(kvCounts)

  const allCounts = [...(relOff ? [] : relCounts), ...(jsonOff ? [] : jsonCounts), ...kvCounts]
  const objectCount = allCounts.every((query) => query.isSuccess)
    ? allCounts.reduce((sum, query) => sum + query.count, 0)
    : undefined

  return { rel, json, kv, kvKeyCount: kv === 'active' ? kvCountQuery.data : undefined, objectCount }
}
