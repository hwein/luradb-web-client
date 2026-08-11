import { withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'
import { messageFromError } from '../sql/sqlRun'

type IndexResponse = components['schemas']['IndexResponse']

export type IndexType = 'string' | 'number' | 'boolean'
export const INDEX_TYPES: readonly IndexType[] = ['string', 'number', 'boolean']

export type CreateIndexOutcome = { status: 'ok'; call: CallMeta; index: IndexResponse } | { status: 'error'; call: CallMeta; message: string }
export type DeleteIndexOutcome = { status: 'ok'; call: CallMeta } | { status: 'error'; call: CallMeta; message: string }

/** Anlage über den typisierten Client (spec data/006 §3); Fehlertext wie reindexStart.ts/sqlRun.ts — 400/409 sind text/plain (live geprüft). */
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

/** `field` geht unverändert (Dot-Notation) in den Pfad — openapi-fetch encodiert Params selbst, `.` bleibt dabei unescaped (live geprüft). */
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

/** Contract liefert Unix-Sekunden — UTC-Datum, locale-unabhängig (Panel-Zeile "field · type · created"). */
export function formatIndexCreatedAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}
