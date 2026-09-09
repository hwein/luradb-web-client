import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { ApiError, BASE_PATH, withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'

/** Echtes Request-`limit` der Browser-Seiten — der Server blättert über `offset`/`limit` (Contract 0.6.1, spec data/011). */
export const KV_KEYS_PAGE_SIZE = 100

/** Server-Maximum (live bestätigt) — eine Seite für die Bulk-Leiste; `total` verrät, ob der Bestand darüber liegt. */
export const KV_BULK_SCAN_LIMIT = 10_000

export function kvKeyPath(domain: string, key: string): string {
  return `${BASE_PATH}/kv/${encodeURIComponent(domain)}/keys/${encodeURIComponent(key)}`
}

export interface KvKeysQuery {
  prefix: string
  contains: string
  limit: number
  offset: number
}

/** Anzeige-Query am `CallMeta`-Pfad (Muster `withQuery` in jsonDocuments.ts) — leere Filter ausgelassen, wie im echten Request. */
function withKeysQuery(path: string, query: KvKeysQuery): string {
  const search = new URLSearchParams()
  if (query.prefix !== '') search.set('prefix', query.prefix)
  if (query.contains !== '') search.set('contains', query.contains)
  search.set('limit', String(query.limit))
  search.set('offset', String(query.offset))
  return `${path}?${search.toString()}`
}

export interface KvKeysPage {
  keys: string[]
  total: number
  offset: number
  limit: number
  call: CallMeta
}

/**
 * Eine Seite des Key-Scans. `total`/`offset`/`limit` kommen aus dem Envelope, nie aus der Anfrage — nur so wird die
 * stille Kappung (`limit` > 10 000 ⇒ effektiv 10 000) sichtbar. Offset-Paging ohne Cursor: ein paralleler Write kann
 * das Fenster verschieben (Dublette/Lücke zwischen zwei Seiten) — nicht kompensiert, die Liste muss Dubletten überstehen.
 */
export async function fetchKvKeysPage(apiClient: ApiClient, domain: string, query: KvKeysQuery): Promise<KvKeysPage> {
  const { data, call } = await withCall<components['schemas']['KeyScanResponse']>('GET', async () => {
    const result = await apiClient.api.GET('/store-api/kv/{domain}/keys', {
      params: {
        path: { domain },
        query: {
          ...(query.prefix !== '' ? { prefix: query.prefix } : {}),
          ...(query.contains !== '' ? { contains: query.contains } : {}),
          limit: query.limit,
          offset: query.offset,
        },
      },
    })
    return { data: result.data, response: result.response }
  })
  if (data === undefined) throw new ApiError(0, 'failed to load keys')
  return { keys: data.keys, total: data.total, offset: data.offset, limit: data.limit, call: { ...call, path: withKeysQuery(call.path, query) } }
}

/** Master-Liste: Seiten hängen sich an; `keys.length > 0` im Guard ist zwingend — eine leere Seite bei `offset < total`
 *  (parallel gelöschte Keys) ergäbe sonst denselben `pageParam` erneut, also eine Endlosschleife. */
export function kvKeysQueryOptions(apiClient: ApiClient | undefined, domain: string, prefix: string, contains: string) {
  return infiniteQueryOptions({
    queryKey: ['kv-keys', domain, prefix, contains] as const,
    queryFn: async ({ pageParam }): Promise<KvKeysPage> => {
      if (!apiClient) throw new Error('kv keys query requires an active connection')
      return fetchKvKeysPage(apiClient, domain, { prefix, contains, limit: KV_KEYS_PAGE_SIZE, offset: pageParam })
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.keys.length
      return lastPage.keys.length > 0 && loaded < lastPage.total ? loaded : undefined
    },
    enabled: apiClient !== undefined,
  })
}

/** Selektionsgrundlage der Bulk-Leiste (spec data/008 §2: der volle Scan, nicht die Seiten der Master-Liste) — eine Seite am Server-Maximum. */
export function kvBulkKeysQueryOptions(apiClient: ApiClient | undefined, domain: string, prefix: string, contains: string) {
  return queryOptions({
    queryKey: ['kv-keys-bulk', domain, prefix, contains] as const,
    queryFn: async (): Promise<KvKeysPage> => {
      if (!apiClient) throw new Error('kv bulk keys query requires an active connection')
      return fetchKvKeysPage(apiClient, domain, { prefix, contains, limit: KV_BULK_SCAN_LIMIT, offset: 0 })
    },
    enabled: apiClient !== undefined,
  })
}

/** Gemeinsamer Helfer für alle KV-Mutationsstellen — hält Master-Liste, Bulk-Scan und den Domänen-Key-Zähler
 *  (`kvKeyCountQueryOptions` in domainDetails.ts) synchron, damit Dots/Tags/Sektionen live nachziehen (spec shell/004 §1).
 *  `'kv-keys-bulk'` braucht die eigene Zeile: Array-Präfix-Matching von `['kv-keys', domain]` greift dort nicht. */
export function invalidateKvKeys(queryClient: QueryClient, domain: string): void {
  void queryClient.invalidateQueries({ queryKey: ['kv-keys', domain] })
  void queryClient.invalidateQueries({ queryKey: ['kv-keys-bulk', domain] })
  void queryClient.invalidateQueries({ queryKey: ['kv-count', domain] })
}

/** Ergebnis eines Value-Reads: `not-found` deckt "nie existiert", "gelöscht" und "abgelaufen" ab (404); `null` ist der explizite
 *  Null-State (204, Contract 0.2.0) — anders als `not-found` bleibt der Key registriert und im Scan sichtbar. */
export type KvValue = { state: 'found'; bytes: number; text: string } | { state: 'not-found' } | { state: 'null' }

/** GET über `fetchRaw` (Roh-Body, kein JSON-Zwang) — 404 wird gefangen und als eigener Zustand modelliert statt als Query-Error;
 *  204 (expliziter Null-State) wird vor dem Body-Read abgefangen, da ein Null-Key sonst von einem Leer-Wert ununterscheidbar wäre. */
export function kvValueQueryOptions(apiClient: ApiClient | undefined, domain: string, key: string | undefined) {
  return queryOptions({
    queryKey: ['kv-value', domain, key ?? ''] as const,
    queryFn: async (): Promise<KvValue> => {
      if (!apiClient || key === undefined) throw new Error('kv value query requires an active connection and key')
      try {
        const response = await apiClient.fetchRaw(kvKeyPath(domain, key))
        if (response.status === 204) return { state: 'null' }
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

/** Feldnamen tragen die Einheit, weil der Server sie in einem Body mischt: `expires_at` in Sekunden, `last_modified_at` in Millisekunden (Probe-Fakt data/012). */
export interface KvMeta {
  expiresAtSecs: number | undefined
  lastModifiedMs: number
}

/** `…/keys/{key}/meta` (Contract 0.6.1) — aufgezeichnet, Antwort auf die Key-Auswahl. 404 (Key zwischen Value- und Meta-GET abgelaufen) ist
 *  kein Query-Fehler, sondern `null` (TanStack lässt `undefined` als Query-Ergebnis nicht zu). */
export function kvMetaQueryOptions(apiClient: ApiClient | undefined, domain: string, key: string | undefined) {
  return queryOptions({
    queryKey: ['kv-meta', domain, key ?? ''] as const,
    queryFn: async (): Promise<KvMeta | null> => {
      if (!apiClient || key === undefined) throw new Error('kv meta query requires an active connection and key')
      const { data, response } = await apiClient.api.GET('/store-api/kv/{domain}/keys/{key}/meta', { params: { path: { domain, key } } })
      if (response.status === 404) return null
      if (!response.ok || !data) throw new ApiError(response.status, 'failed to load key metadata')
      return { expiresAtSecs: data.expires_at ?? undefined, lastModifiedMs: data.last_modified_at }
    },
    enabled: apiClient !== undefined && key !== undefined,
  })
}

/** Kurze Wortform wie `formatUptime` (useConnection.ts): `42s` · `58m` · `5h 3m` · `12d 4h`; negativ ⇒ `0s` (Uhren-Versatz Host ↔ Container).
 *  Rein — kennt weder `Date.now()` noch die Copy, damit Tests ohne Fake-Timer auskommen. */
export function formatShortDuration(totalSecs: number): string {
  const secs = Math.max(0, Math.floor(totalSecs))
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`
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
