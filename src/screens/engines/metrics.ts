import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH, type ApiClient } from '../../api'

export interface SystemMetrics {
  totalReads: number
  totalWrites: number
  compactionRuns: number
  janitorRuns: number
  memtableSizeBytes: number
}

export interface MetricsSnapshot {
  system: SystemMetrics
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : 0
}

/** `domains[]`/`block_cache` sind Teil der Response, bleiben hier aber ungenutzt (spec engines/001 braucht nur `system`). */
function parseMetrics(body: unknown): MetricsSnapshot {
  if (!isRecord(body) || !isRecord(body.system)) throw new Error('unexpected /store-api/metrics response shape')
  const system = body.system
  return {
    system: {
      totalReads: numberField(system, 'total_reads'),
      totalWrites: numberField(system, 'total_writes'),
      compactionRuns: numberField(system, 'compaction_runs'),
      janitorRuns: numberField(system, 'janitor_runs'),
      memtableSizeBytes: numberField(system, 'memtable_size_bytes'),
    },
  }
}

/** `GET /store-api/metrics` hat im Contract kein Response-Schema — `fetchRaw` + manuelles Parsen wie `health.ts`. */
export function metricsQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: ['metrics'] as const,
    queryFn: async (): Promise<MetricsSnapshot> => {
      if (!apiClient) throw new Error('metrics query requires an active connection')
      const response = await apiClient.fetchRaw(`${BASE_PATH}/metrics`)
      return parseMetrics(await response.json())
    },
    enabled: apiClient !== undefined,
    refetchInterval: 5000,
  })
}
