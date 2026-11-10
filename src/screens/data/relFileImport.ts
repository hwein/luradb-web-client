import { ApiError, apiErrorFromResponse, BASE_PATH, type ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { isReservedWord } from '../sql/identifier'
import { isJsonObject } from './jsonDocuments'

export type FileFormat = 'csv' | 'tsv'
export type FileImportResult = components['schemas']['CreateFromFileResponse']
type FileImportColumn = components['schemas']['CreateFromFileColumn']
type FileImportError = components['schemas']['CreateFromFileErrorEntry']

const MAX_NAME_LENGTH = 50

export function formatFromFileName(name: string): FileFormat {
  return /\.(tsv|tab)$/i.test(name) ? 'tsv' : 'csv'
}

export function tableNameFromFileName(name: string): string {
  let result = name
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, '_')
  if (/^[0-9]/.test(result)) result = `t_${result}`
  result = result.slice(0, MAX_NAME_LENGTH)
  return result === '' ? 'imported_table' : result
}

/** Mirrors the server's header normalization (contract 0.17.0, create_table_from_file); registers the result in `seen`. */
export function normalizeColumnName(raw: string, index: number, seen: Set<string>): string {
  let name = raw.trim().toLowerCase()
  if (name === '') name = `col_${index + 1}`
  name = name.replace(/[^a-z0-9_]/gu, '_')
  if (/^[0-9]/.test(name)) name = `c${name}`
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH)
  else if (isReservedWord(name)) name = `${name}_`
  if (seen.has(name)) {
    const base = name
    for (let n = 2; seen.has(name); n++) {
      const suffix = `_${n}`
      name = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix
    }
  }
  seen.add(name)
  return name
}

export function pkCandidates(text: string, format: FileFormat, header: boolean): { name: string; source: string }[] {
  if (text === '') return []
  const newline = text.indexOf('\n')
  const line = (newline === -1 ? text : text.slice(0, newline)).replace(/\r$/, '')
  const fields = line.split(format === 'tsv' ? '\t' : ',')
  const seen = new Set<string>()
  return fields.map((field, index) =>
    header
      ? { name: normalizeColumnName(field, index, seen), source: field }
      : { name: `col_${index + 1}`, source: `col_${index + 1}` },
  )
}

function isFileImportColumn(value: unknown): value is FileImportColumn {
  return isJsonObject(value) && typeof value.name === 'string' && typeof value.type === 'string' && typeof value.primary_key === 'boolean'
}

function isFileImportError(value: unknown): value is FileImportError {
  return isJsonObject(value) && typeof value.row === 'number' && typeof value.error === 'string'
}

function toFileImportResult(body: unknown): FileImportResult {
  if (
    !isJsonObject(body) ||
    typeof body.table !== 'string' ||
    !Array.isArray(body.columns) ||
    typeof body.imported !== 'number' ||
    typeof body.failed !== 'number' ||
    !Array.isArray(body.errors)
  ) {
    throw new ApiError(0, 'unexpected file import response shape')
  }
  return {
    table: body.table,
    columns: body.columns.filter(isFileImportColumn),
    imported: body.imported,
    failed: body.failed,
    errors: body.errors.filter(isFileImportError),
  }
}

export interface FileImportOptions {
  text: string
  name: string
  format: FileFormat
  header: boolean
  pk?: string
}

export function fileImportPath(domain: string, options: FileImportOptions): string {
  const query = new URLSearchParams({ name: options.name, format: options.format, header: options.header ? 'true' : 'false' })
  if (options.pk !== undefined) query.set('pk', options.pk)
  return `${BASE_PATH}/rel/${encodeURIComponent(domain)}/tables/from-file?${query.toString()}`
}

/** Raw text POST (`text/plain`) to create_table_from_file; `postNdjson` does not throw, so non-2xx is translated here. */
export async function runFileImport(apiClient: ApiClient, domain: string, options: FileImportOptions): Promise<FileImportResult> {
  const response = await apiClient.postNdjson(fileImportPath(domain, options), options.text)
  if (!response.ok) throw await apiErrorFromResponse(response)
  return toFileImportResult(await response.json())
}
