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

/** Wie openapi-fetch selbst (live geprüft): 404/503 kommen text/plain — Versuch JSON, sonst Rohtext, dann `messageFromError` (sqlRun.ts). */
async function errorBodyOf(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Bulk-Import (spec data/007 §3): Raw-POST `text/plain`-Body über den Recorder-gehookten Transport — Gegenrichtung zum Export (data/005). */
export async function runBulkImport(apiClient: ApiClient, domain: string, ndjson: string): Promise<BulkImportResult> {
  const response = await apiClient.postNdjson(`${BASE_PATH}/json/${encodeURIComponent(domain)}/bulk`, ndjson)
  if (!response.ok) throw new ApiError(response.status, messageFromError(await errorBodyOf(response), response.status))
  return toBulkImportResult(await response.json())
}

/** Zeilenzähler der Textarea (spec §2) — einzige Client-Vorprüfung, zählt nicht-leere Zeilen ohne jede JSON-Validierung. */
export function countNonEmptyLines(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length
}
