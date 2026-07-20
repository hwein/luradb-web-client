import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH, type ApiClient } from '../../api'
import type { ReindexTaskStatus } from '../../lib/tasks'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Server-Shape ist ein Serde-Tag-Enum (`#[serde(tag = "state", rename_all = "lowercase")]`, luradb engines/json/reindex.rs). */
function parseReindexStatus(body: unknown): ReindexTaskStatus {
  if (!isRecord(body) || typeof body.state !== 'string') throw new Error('unexpected reindex status response shape')
  const processed = typeof body.processed === 'number' ? body.processed : 0

  if (body.state === 'completed') {
    return { kind: 'completed', processed, durationSecs: typeof body.duration_secs === 'number' ? body.duration_secs : 0 }
  }
  if (body.state === 'failed') {
    return { kind: 'failed', processed, error: typeof body.error === 'string' ? body.error : 'reindex failed' }
  }
  return { kind: 'running', processed, totalEstimated: typeof body.total_estimated === 'number' ? body.total_estimated : 0 }
}

/** Poll von `GET /store-api/json/{domain}/reindex/{task_id}` alle 2s — nur aktiv, solange `enabled` (Task noch running). */
export function reindexStatusQueryOptions(apiClient: ApiClient | undefined, domain: string, taskId: string, enabled: boolean) {
  return queryOptions({
    queryKey: ['reindex-status', domain, taskId] as const,
    queryFn: async (): Promise<ReindexTaskStatus> => {
      if (!apiClient) throw new Error('reindex status query requires an active connection')
      const response = await apiClient.fetchRaw(`${BASE_PATH}/json/${encodeURIComponent(domain)}/reindex/${encodeURIComponent(taskId)}`)
      return parseReindexStatus(await response.json())
    },
    enabled,
    refetchInterval: 2000,
  })
}
