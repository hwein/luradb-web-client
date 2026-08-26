import { queryOptions } from '@tanstack/react-query'
import type { ApiClient } from '../../api'

export interface HealthSnapshot {
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

function parseHealth(body: unknown): HealthSnapshot {
  if (!isRecord(body)) throw new Error('unexpected /health response shape')
  return {
    uptimeSecs: numberField(body, 'uptime_secs'),
    domainCount: numberField(body, 'domain_count'),
    estimatedMemtableKeys: numberField(body, 'estimated_memtable_keys'),
    l0SstableCount: numberField(body, 'l0_sstable_count'),
    vlogSizeBytes: numberField(body, 'vlog_size_bytes'),
  }
}

/**
 * `GET /health` liegt ohne `BASE_PATH` (Root-Pfad, vom Proxy/Tauri-Transport gleichermaßen durchgereicht)
 * und hat im Contract kein Response-Schema (`content?: never`) — daher `fetchRaw` + manuelles Parsen,
 * analog zu `metrics.ts`.
 */
export function healthQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: ['health'] as const,
    queryFn: async (): Promise<HealthSnapshot> => {
      if (!apiClient) throw new Error('health query requires an active connection')
      const response = await apiClient.fetchRaw('/health')
      return parseHealth(await response.json())
    },
    enabled: apiClient !== undefined,
    refetchInterval: 5000,
  })
}
