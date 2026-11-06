import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH, type ApiClient } from '../../api'
import { pollSilentRecord } from '../../shell/pollSilentRecord'

export interface SystemMetrics {
  totalReads: number
  totalWrites: number
  compactionRuns: number
  janitorRuns: number
  memtableSizeBytes: number
}

export interface DiskVolume {
  path: string
  sizeBytes: number
  freeBytes: number
}

export interface MetricsResources {
  disk: DiskVolume[]
  memory?: { rssBytes: number; budgetBytes: number }
}

export interface MetricsSnapshot {
  system: SystemMetrics
  resources?: MetricsResources
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : 0
}

/** Only complete numeric entries are kept; nothing is defaulted to 0. */
function parseResources(value: unknown): MetricsResources | undefined {
  if (!isRecord(value)) return undefined
  const disk: DiskVolume[] = []
  if (Array.isArray(value.disk)) {
    for (const volume of value.disk) {
      if (isRecord(volume) && typeof volume.size_bytes === 'number' && typeof volume.free_bytes === 'number') {
        disk.push({ path: typeof volume.path === 'string' ? volume.path : '', sizeBytes: volume.size_bytes, freeBytes: volume.free_bytes })
      }
    }
  }
  const memory = value.memory
  if (isRecord(memory) && typeof memory.rss_anon_bytes === 'number' && typeof memory.budget_bytes === 'number') {
    return { disk, memory: { rssBytes: memory.rss_anon_bytes, budgetBytes: memory.budget_bytes } }
  }
  return { disk }
}

/** `domains[]`/`block_cache` sind Teil der Response, bleiben hier aber ungenutzt (spec engines/001 braucht nur `system`). */
function parseMetrics(body: unknown): MetricsSnapshot {
  if (!isRecord(body) || !isRecord(body.system)) throw new Error('unexpected /store-api/metrics response shape')
  const system = body.system
  const resources = parseResources(body.resources)
  return {
    ...(resources ? { resources } : {}),
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
    queryFn: async (context): Promise<MetricsSnapshot> => {
      if (!apiClient) throw new Error('metrics query requires an active connection')
      const response = await apiClient.fetchRaw(`${BASE_PATH}/metrics`, { silentRecord: pollSilentRecord(context) })
      return parseMetrics(await response.json())
    },
    enabled: apiClient !== undefined,
    refetchInterval: 5000,
  })
}
