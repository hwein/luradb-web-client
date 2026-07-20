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

  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain.name, hasRel))
  const viewsQuery = useQuery(relViewsQueryOptions(apiClient, domain.name, hasRel))
  const jsonDetailQuery = useQuery(jsonDomainDetailQueryOptions(apiClient, domain.name, hasJson))
  const indexesQuery = useQuery(jsonIndexesQueryOptions(apiClient, domain.name, hasJson))
  const keysQuery = useQuery(kvKeysProbeQueryOptions(apiClient, domain.name, hasKv))

  const rel = hasRel
    ? levelFromCounts([
        { isSuccess: tablesQuery.isSuccess, count: tablesQuery.data?.length ?? 0 },
        { isSuccess: viewsQuery.isSuccess, count: viewsQuery.data?.length ?? 0 },
      ])
    : undefined

  const json = hasJson
    ? levelFromCounts([
        { isSuccess: jsonDetailQuery.isSuccess, count: jsonDetailQuery.data?.document_count ?? 0 },
        { isSuccess: indexesQuery.isSuccess, count: indexesQuery.data?.length ?? 0 },
      ])
    : undefined

  const kv = hasKv ? levelFromCounts([{ isSuccess: keysQuery.isSuccess, count: keysQuery.data?.length ?? 0 }]) : undefined

  return { rel, json, kv, kvKeyCount: kv === 'active' ? keysQuery.data?.length : undefined }
}
