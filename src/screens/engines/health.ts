import { queryOptions } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../../api'
import { pollSilentRecord } from '../../shell/pollSilentRecord'

export type ResourceLevel = 'ok' | 'warning' | 'blocked'

export interface ShardHealth {
  id: string
  status: string
}

export interface HealthSnapshot {
  status: 'ok' | 'degraded'
  shards: ShardHealth[]
  resources: { state: ResourceLevel; diskState: ResourceLevel; memoryState: ResourceLevel }
  ioFailures: number
  version: string
  uptimeSecs: number
  domainCount: number
  estimatedMemtableKeys: number
  l0SstableCount: number
  vlogSizeBytes: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : 0
}

// Unknown words are not guessed: they surface as a deviation.
function resourceLevel(record: Record<string, unknown> | undefined, key: string): ResourceLevel {
  const value = record?.[key]
  return value === 'ok' || value === 'blocked' ? value : 'warning'
}

function parseShards(value: unknown): ShardHealth[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((shard) => ({
    id: typeof shard.id === 'number' || typeof shard.id === 'string' ? String(shard.id) : '',
    status: typeof shard.status === 'string' ? shard.status : '',
  }))
}

function parseHealth(body: unknown): HealthSnapshot {
  if (!isRecord(body)) throw new Error('unexpected /health response shape')
  const resources = isRecord(body.resources) ? body.resources : undefined
  const io = isRecord(body.io) ? body.io : undefined
  return {
    status: body.status === 'ok' ? 'ok' : 'degraded',
    shards: parseShards(body.shards),
    resources: {
      state: resourceLevel(resources, 'state'),
      diskState: resourceLevel(resources, 'disk_state'),
      memoryState: resourceLevel(resources, 'memory_state'),
    },
    ioFailures: io ? numberField(io, 'failures') : 0,
    version: typeof body.version === 'string' ? body.version : '',
    uptimeSecs: numberField(body, 'uptime_secs'),
    domainCount: numberField(body, 'domain_count'),
    estimatedMemtableKeys: numberField(body, 'estimated_memtable_keys'),
    l0SstableCount: numberField(body, 'l0_sstable_count'),
    vlogSizeBytes: numberField(body, 'vlog_size_bytes'),
  }
}

/**
 * `GET /health` lives outside `BASE_PATH` (root path, passed through by proxy and Tauri transport alike);
 * 200 and 503 carry `HeartbeatMetrics`, hence `fetchRaw` + manual parsing as in `metrics.ts`.
 * A 503 with an object body is a state (`degraded`), not an error.
 */
export function healthQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: ['health'] as const,
    queryFn: async (context): Promise<HealthSnapshot> => {
      if (!apiClient) throw new Error('health query requires an active connection')
      try {
        const response = await apiClient.fetchRaw('/health', { silentRecord: pollSilentRecord(context) })
        return parseHealth(await response.json())
      } catch (error) {
        if (error instanceof ApiError && error.status === 503 && isRecord(error.body)) return parseHealth(error.body)
        throw error
      }
    },
    enabled: apiClient !== undefined,
    refetchInterval: 5000,
  })
}
