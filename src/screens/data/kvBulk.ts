import { BASE_PATH, type ApiClient } from '../../api'
import { messageFromError } from '../sql/sqlRun'
import { kvKeyPath, type KvKeyFilter } from './kvEntries'

export type KvBulkAction = 'delete' | 'clear' | 'set-null'

/** Fixed limit that spares the per-domain request budget; no UI to change it. */
export const KV_BULK_CONCURRENCY = 8

const METHOD_BY_ACTION: Record<KvBulkAction, string> = {
  delete: 'DELETE',
  clear: 'PUT',
  'set-null': 'PATCH',
}

/** Display path with a literal `{key}` placeholder (not a real call), hence no `encodeURIComponent`. */
export function kvBulkCallPattern(action: KvBulkAction, domain: string): string {
  const suffix = action === 'set-null' ? '/null' : ''
  return `${METHOD_BY_ACTION[action]} ${BASE_PATH}/kv/${domain}/keys/{key}${suffix}`
}

const VERB_BY_ACTION: Record<KvBulkAction, string> = {
  delete: 'delete',
  clear: 'set value to "" on',
  'set-null': 'set null on',
}

/** Confirmation text, e.g. `delete 138 keys in "sessions"?`, for fan-out paths (clear, set null, delete without prefix). */
export function kvBulkConfirmText(action: KvBulkAction, count: number, domain: string): string {
  return `${VERB_BY_ACTION[action]} ${count} keys in "${domain}"?`
}

/** The only place that picks the path: the server endpoint requires a non-empty prefix. */
export function usesServerDelete(action: KvBulkAction, filter: KvKeyFilter): boolean {
  return action === 'delete' && filter.prefix !== ''
}

/** `DELETE …/keys?prefix=…[&contains=…]`; display and call use the same string. */
export function kvBulkDeletePath(domain: string, filter: KvKeyFilter): string {
  const search = new URLSearchParams({ prefix: filter.prefix })
  if (filter.contains !== '') search.set('contains', filter.contains)
  return `${BASE_PATH}/kv/${encodeURIComponent(domain)}/keys?${search.toString()}`
}

/** The server path names the criterion instead of a count; the endpoint also deletes keys added since the scan. */
export function kvBulkServerDeleteConfirmText(domain: string, filter: KvKeyFilter): string {
  const containing = filter.contains === '' ? '' : ` containing "${filter.contains}"`
  return `delete all keys with prefix "${filter.prefix}"${containing} in "${domain}"?`
}

/** One call via `fetchRaw`, recorded (deliberate mutation); non-2xx (413/400/404) already throws the ApiError with the server text there. */
export async function runKvBulkDelete(apiClient: ApiClient, domain: string, filter: KvKeyFilter): Promise<number> {
  const response = await apiClient.fetchRaw(kvBulkDeletePath(domain, filter), { method: 'DELETE' })
  const body: unknown = await response.json()
  const deleted = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).deleted : undefined
  if (typeof deleted !== 'number') throw new Error('unexpected bulk delete response')
  return deleted
}

export type KvBulkOutcome = { kind: 'server'; deleted: number } | { kind: 'fanout'; okCount: number; failures: KvBulkFailure[] }

function requestFor(action: KvBulkAction, domain: string, key: string): { path: string; init: RequestInit } {
  const path = kvKeyPath(domain, key)
  if (action === 'delete') return { path, init: { method: 'DELETE' } }
  if (action === 'clear') return { path, init: { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '' } }
  return { path: `${path}/null`, init: { method: 'PATCH' } }
}

/** Like `errorBodyOf` in jsonBulkImport.ts: try JSON, else raw text; keeps the original 429 text. */
async function errorMessageOf(response: Response): Promise<string> {
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return messageFromError(body, response.status)
}

/** Single call of a bulk run via `fetchSilent`, so no recorder entry. */
export async function runKvBulkOp(apiClient: ApiClient, domain: string, action: KvBulkAction, key: string): Promise<void> {
  const { path, init } = requestFor(action, domain, key)
  const response = await apiClient.fetchSilent(path, init)
  if (!response.ok) throw new Error(await errorMessageOf(response))
}

export interface KvBulkFailure {
  key: string
  message: string
}

export interface KvBulkRunResult {
  okCount: number
  failures: KvBulkFailure[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * UI-free fan-out core: `concurrency` parallel workers pull from the same key list with
 * `allSettled` semantics — one failure does not stop the remaining keys. `executeOp` is injected so tests
 * can check the concurrency limit without fake timers via deliberately resolved promises.
 */
export async function runKvBulk(
  keys: string[],
  concurrency: number,
  executeOp: (key: string) => Promise<void>,
  onProgress: (done: number, total: number) => void,
): Promise<KvBulkRunResult> {
  const total = keys.length
  let okCount = 0
  let done = 0
  let cursor = 0
  const failures: KvBulkFailure[] = []

  async function worker(): Promise<void> {
    while (cursor < keys.length) {
      const index = cursor
      cursor += 1
      const key = keys[index]
      if (key === undefined) continue
      try {
        await executeOp(key)
        okCount += 1
      } catch (error) {
        failures.push({ key, message: messageOf(error) })
      }
      done += 1
      onProgress(done, total)
    }
  }

  const workerCount = Math.min(concurrency, keys.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return { okCount, failures }
}
