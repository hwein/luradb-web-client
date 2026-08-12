import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '../api'
import {
  jsonDomainDetailQueryOptions,
  jsonIndexesQueryOptions,
  kvKeysProbeQueryOptions,
  relTablesQueryOptions,
  relViewsQueryOptions,
} from './domainDetails'
import type { DomainSummary } from './domains'

export type EngineActivityLevel = 'pending' | 'empty' | 'active'

export interface EngineActivity {
  rel: EngineActivityLevel | undefined
  json: EngineActivityLevel | undefined
  kv: EngineActivityLevel | undefined
  kvKeyCount: number | undefined
  /** Belegbare Objektzahl über alle vorhandenen Engines; undefined bis alle Quellen settled sind (Nachtrag admin/001). */
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
 * Store-Aktivität je Registry-Engine der Domäne (spec shell/004 §1): "aktiv" heißt "enthält Objekte"
 * (rel: Tabellen/Views, json: Dokumente/Indexe, kv: Keys) — nicht Registry-Zugehörigkeit. Engine fehlt in
 * der Registry -> undefined. rel/json teilen die Query-Keys mit domainDetails.ts (ein Cache über Explorer,
 * ExpandedDomain und Admin-DomainsCard); für kv liefert dieser Hook zusätzlich den Key-Count aus dem Scan.
 */
export function useEngineActivity(apiClient: ApiClient | undefined, domain: DomainSummary): EngineActivity {
  const hasRel = domain.engines.rel !== undefined
  const hasJson = domain.engines.json !== undefined
  const hasKv = domain.engines.kv !== undefined

  const tablesQuery = useQuery({ ...relTablesQueryOptions(apiClient, domain.name, hasRel), refetchInterval: 60_000 })
  const viewsQuery = useQuery({ ...relViewsQueryOptions(apiClient, domain.name, hasRel), refetchInterval: 60_000 })
  const jsonDetailQuery = useQuery({ ...jsonDomainDetailQueryOptions(apiClient, domain.name, hasJson), refetchInterval: 60_000 })
  const indexesQuery = useQuery({ ...jsonIndexesQueryOptions(apiClient, domain.name, hasJson), refetchInterval: 60_000 })
  const keysQuery = useQuery({ ...kvKeysProbeQueryOptions(apiClient, domain.name, hasKv), refetchInterval: 60_000 })

  const relCounts: CountQuery[] = [
    { isSuccess: tablesQuery.isSuccess, count: tablesQuery.data?.length ?? 0 },
    { isSuccess: viewsQuery.isSuccess, count: viewsQuery.data?.length ?? 0 },
  ]
  const jsonCounts: CountQuery[] = [
    { isSuccess: jsonDetailQuery.isSuccess, count: jsonDetailQuery.data?.document_count ?? 0 },
    { isSuccess: indexesQuery.isSuccess, count: indexesQuery.data?.length ?? 0 },
  ]
  const kvCounts: CountQuery[] = [{ isSuccess: keysQuery.isSuccess, count: keysQuery.data?.length ?? 0 }]

  const rel = hasRel ? levelFromCounts(relCounts) : undefined
  const json = hasJson ? levelFromCounts(jsonCounts) : undefined
  const kv = hasKv ? levelFromCounts(kvCounts) : undefined

  const allCounts = [...(hasRel ? relCounts : []), ...(hasJson ? jsonCounts : []), ...(hasKv ? kvCounts : [])]
  const objectCount = allCounts.every((query) => query.isSuccess)
    ? allCounts.reduce((sum, query) => sum + query.count, 0)
    : undefined

  return { rel, json, kv, kvKeyCount: kv === 'active' ? keysQuery.data?.length : undefined, objectCount }
}
