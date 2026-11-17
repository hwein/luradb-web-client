import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH, type ApiClient } from '../../api'
import { pollSilentRecord } from '../../shell/pollSilentRecord'

export interface SystemMetrics {
  compactionRuns: number
  janitorRuns: number
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

export type EngineTone = 'kv' | 'json' | 'rel'

/** Latencies in µs; a 0 percentile means no op landed in the window. */
export interface EngineMetrics {
  readOps: number
  writeOps: number
  readLatencyUsP50: number
  readLatencyUsP95: number
  writeLatencyUsP50: number
  writeLatencyUsP95: number
  windowSecs: number
}

export interface MetricsSnapshot {
  system: SystemMetrics
  resources?: MetricsResources
  engines: Partial<Record<EngineTone, EngineMetrics>>
}

export const ENGINE_TONES: EngineTone[] = ['kv', 'json', 'rel']
const DEFAULT_WINDOW_SECS = 60

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

function parseEngine(value: unknown): EngineMetrics | undefined {
  if (!isRecord(value)) return undefined
  const windowSecs = numberField(value, 'window_secs')
  return {
    readOps: numberField(value, 'read_ops'),
    writeOps: numberField(value, 'write_ops'),
    readLatencyUsP50: numberField(value, 'read_latency_us_p50'),
    readLatencyUsP95: numberField(value, 'read_latency_us_p95'),
    writeLatencyUsP50: numberField(value, 'write_latency_us_p50'),
    writeLatencyUsP95: numberField(value, 'write_latency_us_p95'),
    windowSecs: windowSecs > 0 ? windowSecs : DEFAULT_WINDOW_SECS,
  }
}

function parseEngines(value: unknown): MetricsSnapshot['engines'] {
  const engines: MetricsSnapshot['engines'] = {}
  if (!isRecord(value)) return engines
  for (const tone of ENGINE_TONES) {
    const engine = parseEngine(value[tone])
    if (engine) engines[tone] = engine
  }
  return engines
}

/** Reads `system`, `resources` and `engines`; the other blocks of the response stay unused. */
function parseMetrics(body: unknown): MetricsSnapshot {
  if (!isRecord(body) || !isRecord(body.system)) throw new Error('unexpected /store-api/metrics response shape')
  const system = body.system
  const resources = parseResources(body.resources)
  return {
    ...(resources ? { resources } : {}),
    engines: parseEngines(body.engines),
    system: {
      compactionRuns: numberField(system, 'compaction_runs'),
      janitorRuns: numberField(system, 'janitor_runs'),
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
