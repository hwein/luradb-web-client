import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { ApiError, BASE_PATH, withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'

type DocumentListResponse = components['schemas']['DocumentListResponse']
type SearchResponse = components['schemas']['SearchResponse']

const PAGE_SIZE = 50
const OMITTED_KEYS = new Set(['_key', '_version'])

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string }

/** Zentrale JSON.parse-Stelle (Filter, Edit, New) — Fehlermeldung inline, nie ein stiller Request. */
export function safeJsonParse(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' }
  }
}

function metaKey(doc: Record<string, unknown>): string {
  return typeof doc._key === 'string' ? doc._key : ''
}

function metaVersion(doc: Record<string, unknown>): number {
  return typeof doc._version === 'number' ? doc._version : 0
}

function withoutMeta(doc: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (!OMITTED_KEYS.has(key)) fields[key] = value
  }
  return fields
}

/** Kompaktiertes JSON ohne `_key`/`_version`, erste ~60 Zeichen (spec §3). */
export function documentPreview(doc: Record<string, unknown>): string {
  const compact = JSON.stringify(withoutMeta(doc))
  return compact.length > 60 ? `${compact.slice(0, 60)}…` : compact
}

export interface DocumentSummary {
  key: string
  version: number
  preview: string
}

function toSummary(doc: Record<string, unknown>): DocumentSummary {
  return { key: metaKey(doc), version: metaVersion(doc), preview: documentPreview(doc) }
}

export interface ParsedFilter {
  text: string
  value: Record<string, unknown>
}

export interface DocumentPage {
  documents: DocumentSummary[]
  total: number
  offset: number
  limit: number
  call: CallMeta
}

function withQuery(path: string, query: Record<string, number>): string {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
  return `${path}?${search}`
}

async function fetchListPage(apiClient: ApiClient, domain: string, offset: number): Promise<DocumentPage> {
  const { data, call } = await withCall<DocumentListResponse>('GET', async () => {
    const result = await apiClient.api.GET('/store-api/json/{domain}/documents', {
      params: { path: { domain }, query: { limit: PAGE_SIZE, offset } },
    })
    return { data: result.data, response: result.response }
  })
  if (data === undefined) throw new ApiError(0, 'failed to load documents')
  return {
    documents: data.documents.map(toSummary),
    total: data.total,
    offset: data.offset,
    limit: data.limit,
    call: { ...call, path: withQuery(call.path, { limit: PAGE_SIZE, offset }) },
  }
}

async function fetchSearchPage(
  apiClient: ApiClient,
  domain: string,
  filter: Record<string, unknown>,
  offset: number,
): Promise<DocumentPage> {
  const body = { filter, limit: PAGE_SIZE, offset }
  const { data, call } = await withCall<SearchResponse>(
    'POST',
    async () => {
      const result = await apiClient.api.POST('/store-api/json/{domain}/search', {
        params: { path: { domain } },
        body: { filter: filter as Record<string, never>, limit: PAGE_SIZE, offset },
      })
      return { data: result.data, response: result.response }
    },
    `body ${JSON.stringify(body)}`,
  )
  if (data === undefined) throw new ApiError(0, 'search failed')
  return { documents: data.documents.map(toSummary), total: data.total, offset: data.offset, limit: data.limit, call }
}

/** Liste (leerer Filter) oder Suche (Filter gesetzt), Seiten hängen sich an — Query-Key trägt Domäne+Filtertext (spec §2/§3). */
export function jsonDocumentsQueryOptions(apiClient: ApiClient | undefined, domain: string, filter: ParsedFilter | undefined) {
  return infiniteQueryOptions({
    queryKey: ['json-documents', domain, filter?.text ?? ''] as const,
    queryFn: async ({ pageParam }): Promise<DocumentPage> => {
      if (!apiClient) throw new Error('document query requires an active connection')
      return filter === undefined
        ? fetchListPage(apiClient, domain, pageParam)
        : fetchSearchPage(apiClient, domain, filter.value, pageParam)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.documents.length
      return loaded < lastPage.total ? loaded : undefined
    },
    enabled: apiClient !== undefined,
  })
}

export interface DocumentDetail {
  key: string
  version: number
  /** Dokumentinhalt ohne `_key`/`_version` — Anzeige- und Edit-Grundlage (spec §4). */
  fields: Record<string, unknown>
  etag: string | undefined
}

export function documentPath(domain: string, key: string): string {
  return `${BASE_PATH}/json/${encodeURIComponent(domain)}/documents/${encodeURIComponent(key)}`
}

/** GET Einzeldokument über `fetchRaw`: der Contract lässt den Response-Body/ETag-Header untypisiert (json/011). */
export function jsonDocumentQueryOptions(apiClient: ApiClient | undefined, domain: string, key: string | undefined) {
  return queryOptions({
    queryKey: ['json-document', domain, key ?? ''] as const,
    queryFn: async (): Promise<DocumentDetail> => {
      if (!apiClient || key === undefined) throw new Error('document detail query requires an active connection and key')
      const response = await apiClient.fetchRaw(documentPath(domain, key))
      const body: unknown = await response.json()
      if (!isJsonObject(body)) throw new ApiError(response.status, 'unexpected document shape')
      return { key: metaKey(body), version: metaVersion(body), fields: withoutMeta(body), etag: response.headers.get('etag') ?? undefined }
    },
    enabled: apiClient !== undefined && key !== undefined,
  })
}

export async function putDocument(apiClient: ApiClient, domain: string, key: string, etag: string | undefined, fields: unknown): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (etag !== undefined) headers['If-Match'] = etag
  await apiClient.fetchRaw(documentPath(domain, key), { method: 'PUT', headers, body: JSON.stringify(fields) })
}

/** Server vergibt den Key; die 201-Antwort ist laut Contract inhaltslos, liefert real aber das Dokument inkl. `_key`. */
export async function createDocument(apiClient: ApiClient, domain: string, fields: unknown): Promise<string> {
  const response = await apiClient.fetchRaw(`${BASE_PATH}/json/${encodeURIComponent(domain)}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  const body: unknown = await response.json()
  if (!isJsonObject(body) || typeof body._key !== 'string') throw new ApiError(response.status, 'unexpected create response')
  return body._key
}

export async function deleteDocument(apiClient: ApiClient, domain: string, key: string): Promise<void> {
  await apiClient.fetchRaw(documentPath(domain, key), { method: 'DELETE' })
}

export class KeyExistsError extends Error {
  constructor() {
    super('key already exists')
    this.name = 'KeyExistsError'
  }
}

/**
 * Kollisions-Precheck vor einem PUT auf einen selbstgewählten Key (spec 004 §1): der Server überschreibt
 * existente Dokumente kommentarlos (Probe-Fakt), also prüft der Client per GET vor. Race zwischen diesem
 * Check und dem folgenden PUT bleibt bestehen (keine Server-Precondition) — bewusst in Kauf genommen.
 */
export async function assertKeyAvailable(apiClient: ApiClient, domain: string, key: string): Promise<void> {
  try {
    await apiClient.fetchRaw(documentPath(domain, key))
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return
    throw error
  }
  throw new KeyExistsError()
}

/** Server antwortet auf ein If-Match-Mismatch mit 409 (live geprüft); 412 wäre die HTTP-übliche Alternative — beide gelten als Konflikt. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 412)
}
