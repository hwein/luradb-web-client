import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { ApiError, BASE_PATH, withCall, type ApiClient, type CallMeta } from '../../api'

/** Contract kennt kein `limit`/`offset` auf `scan_keys` (Response ist ein flaches `string[]`) — "load more" ist eine
 *  rein client-seitige Anzeige-Stufe über dem vollständigen Scan-Ergebnis, kein Nachladen (spec §2, Abweichung s. Bericht). */
export const KV_KEYS_PAGE_SIZE = 100

export function kvKeyPath(domain: string, key: string): string {
  return `${BASE_PATH}/kv/${encodeURIComponent(domain)}/keys/${encodeURIComponent(key)}`
}

function withPrefixQuery(path: string, prefix: string): string {
  return prefix === '' ? path : `${path}?${new URLSearchParams({ prefix }).toString()}`
}

export interface KvKeysResult {
  keys: string[]
  call: CallMeta
}

export function kvKeysQueryOptions(apiClient: ApiClient | undefined, domain: string, prefix: string) {
  return queryOptions({
    queryKey: ['kv-keys', domain, prefix] as const,
    queryFn: async (): Promise<KvKeysResult> => {
      if (!apiClient) throw new Error('kv keys query requires an active connection')
      const { data, call } = await withCall<string[]>('GET', async () => {
        const result = await apiClient.api.GET('/store-api/kv/{domain}/keys', {
          params: { path: { domain }, query: prefix === '' ? undefined : { prefix } },
        })
        return { data: result.data, response: result.response }
      })
      if (data === undefined) throw new ApiError(0, 'failed to load keys')
      return { keys: data, call: { ...call, path: withPrefixQuery(call.path, prefix) } }
    },
    enabled: apiClient !== undefined,
  })
}

/** Gemeinsamer Helfer für alle KV-Mutationsstellen — hält die Key-Liste und die stille Aktivitäts-Probe
 *  (`kvKeysProbeQueryOptions` in domainDetails.ts) synchron, damit Dots/Tags/Sektionen live nachziehen (spec shell/004 §1). */
export function invalidateKvKeys(queryClient: QueryClient, domain: string): void {
  void queryClient.invalidateQueries({ queryKey: ['kv-keys', domain] })
  void queryClient.invalidateQueries({ queryKey: ['kv-keys-probe', domain] })
}

/** Ergebnis eines Value-Reads: `not-found` deckt sowohl "nie existiert" als auch "gelöscht/getombstoned" ab (404 ununterscheidbar, live geprüft). */
export type KvValue = { state: 'found'; bytes: number; text: string } | { state: 'not-found' }

/** GET über `fetchRaw` (Roh-Body, kein JSON-Zwang) — 404 wird gefangen und als eigener Zustand modelliert statt als Query-Error. */
export function kvValueQueryOptions(apiClient: ApiClient | undefined, domain: string, key: string | undefined) {
  return queryOptions({
    queryKey: ['kv-value', domain, key ?? ''] as const,
    queryFn: async (): Promise<KvValue> => {
      if (!apiClient || key === undefined) throw new Error('kv value query requires an active connection and key')
      try {
        const response = await apiClient.fetchRaw(kvKeyPath(domain, key))
        const text = await response.text()
        return { state: 'found', bytes: new TextEncoder().encode(text).length, text }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return { state: 'not-found' }
        throw error
      }
    },
    enabled: apiClient !== undefined && key !== undefined,
  })
}

function withTtlQuery(path: string, ttlSeconds: number | undefined): string {
  return ttlSeconds === undefined ? path : `${path}?${new URLSearchParams({ ttl: String(ttlSeconds) }).toString()}`
}

/** PUT ist Upsert — Contract kennt kein ETag/If-Match für KV (kein Versionskonflikt möglich, anders als bei JSON).
 *  `ttlSeconds` hängt `?ttl=` nur bei Angabe an — jeder PUT ohne ttl macht einen befristeten Key wieder unbefristet (Probe-Fakt, spec data/005). */
export async function putValue(apiClient: ApiClient, domain: string, key: string, value: string, ttlSeconds?: number): Promise<void> {
  await apiClient.fetchRaw(withTtlQuery(kvKeyPath(domain, key), ttlSeconds), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: value,
  })
}

export type TtlParseResult = { ok: true; seconds: number | undefined } | { ok: false; error: string }

/** Leer ⇒ kein Param (unbefristet); sonst ganze Zahl ≥ 1 — `ttl=0` wird bewusst nicht angeboten (sofort abgelaufen, s. Probe-Fakt). */
export function parseTtlSeconds(text: string): TtlParseResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, seconds: undefined }
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 ? { ok: true, seconds: value } : { ok: false, error: 'ttl must be a positive integer (seconds)' }
}

export async function setNullValue(apiClient: ApiClient, domain: string, key: string): Promise<void> {
  await apiClient.fetchRaw(`${kvKeyPath(domain, key)}/null`, { method: 'PATCH' })
}

export async function deleteValue(apiClient: ApiClient, domain: string, key: string): Promise<void> {
  await apiClient.fetchRaw(kvKeyPath(domain, key), { method: 'DELETE' })
}

/** `undefined` heißt "kein gültiges JSON" — `JSON.parse` kann nie echtes `undefined` liefern, der Sentinel ist eindeutig. */
export function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
