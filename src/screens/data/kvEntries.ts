import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { ApiError, BASE_PATH, withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'
import { kvCountKey } from '../../shell/domainDetails'

/** Real request `limit` of the browser pages; the server pages via `offset`/`limit`. */
export const KV_KEYS_PAGE_SIZE = 100

/** Server maximum: one page for the bulk bar; `total` reveals whether more keys exist. */
export const KV_BULK_SCAN_LIMIT = 10_000

export function kvKeyPath(domain: string, key: string): string {
  return `${BASE_PATH}/kv/${encodeURIComponent(domain)}/keys/${encodeURIComponent(key)}`
}

/** The two server filters of the key scan; they always travel together. */
export interface KvKeyFilter {
  prefix: string
  contains: string
}

export const EMPTY_KV_KEY_FILTER: KvKeyFilter = { prefix: '', contains: '' }

export interface KvKeysQuery extends KvKeyFilter {
  limit: number
  offset: number
}

/** Display query on the `CallMeta` path; empty filters omitted, as in the real request. */
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
 * One page of the key scan. `total`/`offset`/`limit` come from the envelope, never the request, so the silent
 * clamp (`limit` > 10 000 ⇒ effectively 10 000) shows. Offset paging has no cursor: a parallel write can shift the
 * window (duplicate/gap between pages); not compensated, the list must tolerate duplicates.
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

/** Master list: pages append; the `keys.length > 0` guard is mandatory, since an empty page at `offset < total`
 *  (keys deleted in parallel) would yield the same `pageParam` again, an endless loop. */
export function kvKeysQueryOptions(apiClient: ApiClient | undefined, domain: string, filter: KvKeyFilter) {
  return infiniteQueryOptions({
    queryKey: ['kv-keys', domain, filter.prefix, filter.contains] as const,
    queryFn: async ({ pageParam }): Promise<KvKeysPage> => {
      if (!apiClient) throw new Error('kv keys query requires an active connection')
      return fetchKvKeysPage(apiClient, domain, { ...filter, limit: KV_KEYS_PAGE_SIZE, offset: pageParam })
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.keys.length
      return lastPage.keys.length > 0 && loaded < lastPage.total ? loaded : undefined
    },
    enabled: apiClient !== undefined,
  })
}

/** Selection basis of the bulk bar: the full scan, not the master list's pages; one page at the server maximum. */
export function kvBulkKeysQueryOptions(apiClient: ApiClient | undefined, domain: string, filter: KvKeyFilter) {
  return queryOptions({
    queryKey: ['kv-keys-bulk', domain, filter.prefix, filter.contains] as const,
    queryFn: async (): Promise<KvKeysPage> => {
      if (!apiClient) throw new Error('kv bulk keys query requires an active connection')
      return fetchKvKeysPage(apiClient, domain, { ...filter, limit: KV_BULK_SCAN_LIMIT, offset: 0 })
    },
    enabled: apiClient !== undefined,
  })
}

/** Shared helper for all KV mutation sites: keeps the master list, bulk scan and the domain key counter
 *  (`kvKeyCountQueryOptions` in domainDetails.ts) in sync so dots/tags/sections update live.
 *  `'kv-keys-bulk'` needs its own line: array-prefix matching of `['kv-keys', domain]` does not reach it. */
export function invalidateKvKeys(queryClient: QueryClient, domain: string): void {
  void queryClient.invalidateQueries({ queryKey: ['kv-keys', domain] })
  void queryClient.invalidateQueries({ queryKey: ['kv-keys-bulk', domain] })
  void queryClient.invalidateQueries({ queryKey: kvCountKey(domain) })
}

/** Result of a value read: `not-found` covers "never existed", "deleted" and "expired" (404); `null` is the explicit
 *  null state (204); unlike `not-found` the key stays registered and visible in the scan.
 *  `etag` is the opaque `ETag` header of 200/204 (undefined if absent). */
export type KvValue = { state: 'found'; bytes: number; text: string; etag: string | undefined } | { state: 'not-found' } | { state: 'null'; etag: string | undefined }

/** GET via `fetchRaw` (raw body, no JSON coercion); 404 is caught and modelled as its own state, not a query error;
 *  204 (explicit null state) is handled before the body read, since a null key would otherwise look like an empty value. */
export function kvValueQueryOptions(apiClient: ApiClient | undefined, domain: string, key: string | undefined) {
  return queryOptions({
    queryKey: ['kv-value', domain, key ?? ''] as const,
    queryFn: async (): Promise<KvValue> => {
      if (!apiClient || key === undefined) throw new Error('kv value query requires an active connection and key')
      try {
        const response = await apiClient.fetchRaw(kvKeyPath(domain, key))
        const etag = response.headers.get('etag') ?? undefined
        if (response.status === 204) return { state: 'null', etag }
        const text = await response.text()
        return { state: 'found', bytes: new TextEncoder().encode(text).length, text, etag }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return { state: 'not-found' }
        throw error
      }
    },
    enabled: apiClient !== undefined && key !== undefined,
  })
}

/** Field names carry the unit because the server mixes them in one body: `expires_at` in seconds, `last_modified_at` in milliseconds. */
export interface KvMeta {
  expiresAtSecs: number | undefined
  lastModifiedMs: number
}

/** `…/keys/{key}/meta`: recorded, answers the key selection. 404 (key expired between the value and meta GET) is
 *  not a query error but `null` (TanStack does not allow `undefined` as a query result). */
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

/** Short form like `formatUptime` (useConnection.ts): `42s` · `58m` · `5h 3m` · `12d 4h`; negative ⇒ `0s` (clock skew host ↔ container).
 *  Pure: knows neither `Date.now()` nor the copy, so tests need no fake timers. */
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

export interface KvPutCondition {
  etag?: string
  createOnly?: boolean
}

/** `createOnly` wins over `etag`; no condition ⇒ no header (unconditional write). */
function conditionHeaders(condition: KvPutCondition): Record<string, string> {
  if (condition.createOnly) return { 'If-None-Match': '*' }
  if (condition.etag !== undefined) return { 'If-Match': condition.etag }
  return {}
}

/** PUT is an upsert unless conditional (If-Match / If-None-Match: *, since 0.5.1; 412/428 on mismatch).
 *  `ttlSeconds` appends `?ttl=` only when given; any PUT without ttl makes an expiring key permanent again. */
export async function putValue(apiClient: ApiClient, domain: string, key: string, value: string, ttlSeconds?: number, condition: KvPutCondition = {}): Promise<void> {
  await apiClient.fetchRaw(withTtlQuery(kvKeyPath(domain, key), ttlSeconds), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', ...conditionHeaders(condition) },
    body: value,
  })
}

export type TtlParseResult = { ok: true; seconds: number | undefined } | { ok: false; error: string }

/** Empty ⇒ no param (permanent); otherwise an integer ≥ 1; `ttl=0` is deliberately not offered (expires immediately). */
export function parseTtlSeconds(text: string): TtlParseResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, seconds: undefined }
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 ? { ok: true, seconds: value } : { ok: false, error: 'ttl must be a positive integer (seconds)' }
}

export async function setNullValue(apiClient: ApiClient, domain: string, key: string, etag?: string): Promise<void> {
  await apiClient.fetchRaw(`${kvKeyPath(domain, key)}/null`, { method: 'PATCH', headers: conditionHeaders({ etag }) })
}

export async function deleteValue(apiClient: ApiClient, domain: string, key: string, etag?: string): Promise<void> {
  await apiClient.fetchRaw(kvKeyPath(domain, key), { method: 'DELETE', headers: conditionHeaders({ etag }) })
}

/** `undefined` means "not valid JSON"; `JSON.parse` never yields a real `undefined`, so the sentinel is unambiguous. */
export function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
