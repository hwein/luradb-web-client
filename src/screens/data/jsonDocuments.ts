import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { ApiError, BASE_PATH, withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'

type DocumentListResponse = components['schemas']['DocumentListResponse']
type SearchResponse = components['schemas']['SearchResponse']
type DocumentResponse = components['schemas']['DocumentResponse']

const PAGE_SIZE = 50
const OMITTED_KEYS = new Set(['_key', '_version'])

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string }

/** Central JSON.parse site (filter, edit, new): error shown inline, never a silent request. */
export function safeJsonParse(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' }
  }
}

function withoutMeta(doc: DocumentResponse): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (!OMITTED_KEYS.has(key)) fields[key] = value
  }
  return fields
}

/**
 * Content of a document: the server stores a non-object document as `{_content: …}` (probe fact), so `_content` is the
 * content when it is the only field; otherwise (also a legacy object with `_content`) the document without `_key`/`_version`.
 */
function documentContent(doc: DocumentResponse): unknown {
  const fields = withoutMeta(doc)
  const names = Object.keys(fields)
  return names.length === 1 && names[0] === '_content' ? fields._content : fields
}

/** Compact JSON without meta fields, first ~60 characters. */
export function documentPreview(doc: DocumentResponse): string {
  const compact = JSON.stringify(documentContent(doc))
  return compact.length > 60 ? `${compact.slice(0, 60)}…` : compact
}

export interface DocumentSummary {
  key: string
  version: number
  preview: string
}

function toSummary(doc: DocumentResponse): DocumentSummary {
  return { key: doc._key, version: doc._version, preview: documentPreview(doc) }
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

/** List (empty filter) or search (filter set), pages append; the query key carries domain + filter text. */
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
  /** Document content without meta fields, the basis for display and edit; scalar for `_content` documents. */
  fields: unknown
  etag: string | undefined
}

export function documentPath(domain: string, key: string): string {
  return `${BASE_PATH}/json/${encodeURIComponent(domain)}/documents/${encodeURIComponent(key)}`
}

/** Single-document GET stays on `fetchRaw`: the typed client does not pass the `ETag` header through and throws on 404. */
export function jsonDocumentQueryOptions(apiClient: ApiClient | undefined, domain: string, key: string | undefined) {
  return queryOptions({
    queryKey: ['json-document', domain, key ?? ''] as const,
    queryFn: async (): Promise<DocumentDetail> => {
      if (!apiClient || key === undefined) throw new Error('document detail query requires an active connection and key')
      const response = await apiClient.fetchRaw(documentPath(domain, key))
      const body: unknown = await response.json()
      if (!isJsonObject(body) || typeof body._key !== 'string') throw new ApiError(response.status, 'unexpected document shape')
      const doc = body as DocumentResponse
      return { key: doc._key, version: doc._version, fields: documentContent(doc), etag: response.headers.get('etag') ?? undefined }
    },
    enabled: apiClient !== undefined && key !== undefined,
  })
}

/** Write paths stay on `fetchRaw`: the contract types the request body as `Record<string, never>`, so the typed client would only add a cast. */
export async function putDocument(apiClient: ApiClient, domain: string, key: string, etag: string | undefined, fields: unknown): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (etag !== undefined) headers['If-Match'] = etag
  await apiClient.fetchRaw(documentPath(domain, key), { method: 'PUT', headers, body: JSON.stringify(fields) })
}

/** Server assigns the key; the 201 response holds the created document incl. `_key`. */
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

/** Without an ETag the DELETE stays unconditional. */
export async function deleteDocument(apiClient: ApiClient, domain: string, key: string, etag: string | undefined): Promise<void> {
  const headers: Record<string, string> = {}
  if (etag !== undefined) headers['If-Match'] = etag
  await apiClient.fetchRaw(documentPath(domain, key), { method: 'DELETE', headers })
}

export class KeyExistsError extends Error {
  constructor() {
    super('key already exists')
    this.name = 'KeyExistsError'
  }
}

/** Create-only PUT: the server rejects an existing key with 412. */
export async function createDocumentWithKey(apiClient: ApiClient, domain: string, key: string, fields: unknown): Promise<void> {
  try {
    await apiClient.fetchRaw(documentPath(domain, key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: JSON.stringify(fields),
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 412) throw new KeyExistsError()
    throw error
  }
}

/** 412 is the precondition-failed code for If-Match / If-None-Match; the caller decides what it means. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 412
}
