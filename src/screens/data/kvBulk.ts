import { BASE_PATH, type ApiClient } from '../../api'
import { messageFromError } from '../sql/sqlRun'
import { kvKeyPath, type KvKeyFilter } from './kvEntries'

export type KvBulkAction = 'delete' | 'clear' | 'set-null'

/** Feste Schranke, schont das Request-Budget je Domäne (spec §5) — kein UI zum Verstellen. */
export const KV_BULK_CONCURRENCY = 8

const METHOD_BY_ACTION: Record<KvBulkAction, string> = {
  delete: 'DELETE',
  clear: 'PUT',
  'set-null': 'PATCH',
}

/** Anzeige-Pfad mit literalem `{key}`-Platzhalter (spec §5, kein echter Call) — daher kein `encodeURIComponent`. */
export function kvBulkCallPattern(action: KvBulkAction, domain: string): string {
  const suffix = action === 'set-null' ? '/null' : ''
  return `${METHOD_BY_ACTION[action]} ${BASE_PATH}/kv/${domain}/keys/{key}${suffix}`
}

const VERB_BY_ACTION: Record<KvBulkAction, string> = {
  delete: 'delete',
  clear: 'set value to "" on',
  'set-null': 'set null on',
}

/** Bestätigungstext (spec §4), z. B. `delete 138 keys in "sessions"?` — Fanout-Wege (clear, set null, delete ohne Prefix). */
export function kvBulkConfirmText(action: KvBulkAction, count: number, domain: string): string {
  return `${VERB_BY_ACTION[action]} ${count} keys in "${domain}"?`
}

/** Einzige Stelle, die den Weg entscheidet (spec data/013 §1): der Server-Endpunkt verlangt einen nicht-leeren Prefix. */
export function usesServerDelete(action: KvBulkAction, filter: KvKeyFilter): boolean {
  return action === 'delete' && filter.prefix !== ''
}

/** `DELETE …/keys?prefix=…[&contains=…]` — Anzeige und Call nutzen denselben String (spec data/013 §2/§5). */
export function kvBulkDeletePath(domain: string, filter: KvKeyFilter): string {
  const search = new URLSearchParams({ prefix: filter.prefix })
  if (filter.contains !== '') search.set('contains', filter.contains)
  return `${BASE_PATH}/kv/${encodeURIComponent(domain)}/keys?${search.toString()}`
}

/** Server-Weg nennt das Kriterium statt einer Zahl — der Endpunkt löscht auch Keys, die seit dem Scan dazukamen (spec data/013 §4). */
export function kvBulkServerDeleteConfirmText(domain: string, filter: KvKeyFilter): string {
  const containing = filter.contains === '' ? '' : ` containing "${filter.contains}"`
  return `delete all keys with prefix "${filter.prefix}"${containing} in "${domain}"?`
}

/** Ein Call über `fetchRaw` — aufgezeichnet (bewusste Mutation, general/012); Nicht-2xx (413/400/404) wirft dort bereits den ApiError mit dem Servertext. */
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

/** Wie `errorBodyOf` in jsonBulkImport.ts (live geprüft): Versuch JSON, sonst Rohtext — bewahrt den 429-Originaltext (spec §5/§7). */
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

/** Einzel-Call eines Bulk-Laufs — über `fetchSilent`, also ohne Recorder-Eintrag (spec §5). */
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
 * UI-freier Fanout-Kern (spec §5): `concurrency` parallele Worker ziehen von derselben Key-Liste,
 * `allSettled`-Semantik wie die Löschkaskade (engineCascade.ts) — ein Fehlschlag bricht die übrigen
 * Keys nicht ab. `executeOp` ist injiziert, damit Tests die Parallelitäts-Schranke ohne Fake-Timer
 * über gezielt aufgelöste Promises prüfen können (spec §7).
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
