import { withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'
import { messageFromError } from '../sql/sqlRun'

type IndexResponse = components['schemas']['IndexResponse']

export type IndexType = 'string' | 'number' | 'boolean'
export const INDEX_TYPES: readonly IndexType[] = ['string', 'number', 'boolean']

export type CreateIndexOutcome = { status: 'ok'; call: CallMeta; index: IndexResponse } | { status: 'error'; call: CallMeta; message: string }
export type DeleteIndexOutcome = { status: 'ok'; call: CallMeta } | { status: 'error'; call: CallMeta; message: string }

/** Create via the typed client; error text like reindexStart.ts/sqlRun.ts, since 400/409 are text/plain (verified live). */
export async function createIndex(apiClient: ApiClient, domain: string, field: string, type: IndexType): Promise<CreateIndexOutcome> {
  let errorBody: unknown
  const { data, call } = await withCall<IndexResponse>('POST', async () => {
    const result = await apiClient.api.POST('/store-api/json/{domain}/indexes', {
      params: { path: { domain } },
      body: { field, type },
    })
    errorBody = result.error
    return { data: result.data, response: result.response }
  })
  if (call.status === 201 && data !== undefined) return { status: 'ok', call, index: data }
  return { status: 'error', call, message: messageFromError(errorBody, call.status) }
}

/** `field` goes into the path unchanged (dot notation); openapi-fetch encodes params itself and leaves `.` unescaped (verified live). */
export async function deleteIndex(apiClient: ApiClient, domain: string, field: string): Promise<DeleteIndexOutcome> {
  let errorBody: unknown
  const { call } = await withCall('DELETE', async () => {
    const result = await apiClient.api.DELETE('/store-api/json/{domain}/indexes/{field}', {
      params: { path: { domain, field } },
    })
    errorBody = result.error
    return { data: result.data, response: result.response }
  })
  if (call.status === 204) return { status: 'ok', call }
  return { status: 'error', call, message: messageFromError(errorBody, call.status) }
}

/** The contract returns Unix seconds; UTC date, locale-independent (panel row "field · type · created"). */
export function formatIndexCreatedAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}
