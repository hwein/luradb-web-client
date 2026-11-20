import { ApiError, BASE_PATH, type ApiClient } from '../../api'
import { messageFromError } from '../sql/sqlRun'
import { isJsonObject } from './jsonDocuments'

export interface BulkImportError {
  key: string
  error: string
}

export interface BulkImportResult {
  imported: number
  failed: number
  errors: BulkImportError[]
}

function isBulkImportError(value: unknown): value is BulkImportError {
  return isJsonObject(value) && typeof value.key === 'string' && typeof value.error === 'string'
}

function toBulkImportResult(body: unknown): BulkImportResult {
  if (!isJsonObject(body) || typeof body.imported !== 'number' || typeof body.failed !== 'number' || !Array.isArray(body.errors)) {
    throw new ApiError(0, 'unexpected bulk import response shape')
  }
  return { imported: body.imported, failed: body.failed, errors: body.errors.filter(isBulkImportError) }
}

/** Like openapi-fetch itself (verified live): 404/503 come as text/plain; try JSON, else raw text, then `messageFromError` (sqlRun.ts). */
async function errorBodyOf(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Bulk import: raw POST with a `text/plain` body over the recorder-hooked transport; the counterpart of the export. */
export async function runBulkImport(apiClient: ApiClient, domain: string, ndjson: string): Promise<BulkImportResult> {
  const response = await apiClient.postNdjson(`${BASE_PATH}/json/${encodeURIComponent(domain)}/bulk`, ndjson)
  if (!response.ok) throw new ApiError(response.status, messageFromError(await errorBodyOf(response), response.status))
  return toBulkImportResult(await response.json())
}

/** Line counter of the textarea: the only client-side precheck, counts non-empty lines without any JSON validation. */
export function countNonEmptyLines(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length
}
