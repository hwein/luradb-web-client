import type { ApiClient, CallMeta } from '../../api'
import { withCall } from '../../api'
import type { components } from '../../api/schema'

export interface SqlColumn {
  name: string
  type: string
}

/** Resolved link values per expanded column, index-aligned with `rows`. */
export type ExpandedMap = Record<string, unknown[]>

export interface SqlSelectResult {
  kind: 'select'
  columns: SqlColumn[]
  rows: unknown[][]
  rowCount: number
  limitApplied: boolean
  expanded?: ExpandedMap
}

export type SqlResult =
  | SqlSelectResult
  | { kind: 'ddl'; label: string }
  | { kind: 'dml'; affected: number; lastPk: unknown }

export type SqlOutcome =
  | { status: 'ok'; call: CallMeta; result: SqlResult }
  | { status: 'error'; call: CallMeta; message: string; docId: string }

export interface SqlRequestBody {
  sql: string
  expand?: string[]
  params?: unknown[]
}

/** `expand` is only valid for SELECT (otherwise 400), so send it only then. */
export function isSelect(sql: string): boolean {
  return /^\s*select\b/i.test(sql)
}

export const PARAMS_ERROR = 'params must be a JSON array'

export type ParamsParseResult = { ok: true; params: unknown[] } | { ok: false; error: string }

/** Empty/whitespace means no params array; otherwise the text must parse as a JSON array. */
export function parseParams(text: string): ParamsParseResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, params: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: PARAMS_ERROR }
  }
  return Array.isArray(parsed) ? { ok: true, params: parsed } : { ok: false, error: PARAMS_ERROR }
}

/** `params` applies to every statement class, unlike the SELECT-only `expand`. */
export function buildSqlRequest(sql: string, expand: string[], params: unknown[]): SqlRequestBody {
  const body: SqlRequestBody = { sql }
  if (isSelect(sql) && expand.length > 0) body.expand = expand
  if (params.length > 0) body.params = params
  return body
}

/** DDL confirmation "ok · CREATE VIEW": the leading statement keyword (+ TABLE/VIEW/INDEX). */
export function statementLabel(sql: string): string {
  const tokens = sql.trim().split(/\s+/)
  const first = (tokens[0] ?? '').toUpperCase()
  const second = (tokens[1] ?? '').toUpperCase()
  if ((first === 'CREATE' || first === 'DROP' || first === 'ALTER') && ['TABLE', 'VIEW', 'INDEX'].includes(second)) {
    return `${first} ${second}`
  }
  return first
}

/** Save-as-view: `CREATE VIEW <name> AS <sql>`; a trailing `;` would end the statement early. */
export function buildCreateViewSql(name: string, editorSql: string): string {
  const inner = editorSql.trim().replace(/;\s*$/, '').trim()
  return `CREATE VIEW ${name} AS ${inner}`
}

export function docIdForStatus(status: number): string {
  if (status === 409) return 'cross-engine-links'
  if (status === 400) return 'lurasql'
  return 'errors-status-codes'
}

/** LuraDB returns SQL errors as a text/plain body; openapi-fetch puts it (JSON-parsed, else as a string) in `error`. */
export function messageFromError(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim() !== '') return body.trim()
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.message === 'string') return record.message
  }
  return `request failed (HTTP ${status})`
}

function toColumn(value: unknown): SqlColumn {
  const record = (value ?? {}) as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : '',
    type: typeof record.type === 'string' ? record.type : '',
  }
}

function toExpanded(value: unknown): ExpandedMap | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const out: ExpandedMap = {}
  for (const [column, resolutions] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(resolutions)) out[column] = resolutions
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Narrow the union by field presence (no guessing): SELECT has `columns`+`rows`, DML `affected`, DDL `ok`. */
export function parseSqlResult(data: unknown): SqlResult | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  if (Array.isArray(record.columns) && Array.isArray(record.rows)) {
    return {
      kind: 'select',
      columns: record.columns.map(toColumn),
      rows: record.rows.map((row) => (Array.isArray(row) ? row : [row])),
      rowCount: typeof record.row_count === 'number' ? record.row_count : record.rows.length,
      limitApplied: record.limit_applied === true,
      expanded: toExpanded(record.expanded),
    }
  }
  if (typeof record.affected === 'number') {
    return { kind: 'dml', affected: record.affected, lastPk: record.last_pk ?? null }
  }
  if (record.ok === true) return { kind: 'ddl', label: '' }
  return undefined
}

/** One JSON line per result row (column name → value); expanded values are embedded as `_expanded`. */
export function buildNdjson(result: SqlSelectResult): string {
  return result.rows
    .map((row, rowIndex) => {
      const object: Record<string, unknown> = {}
      result.columns.forEach((column, index) => {
        object[column.name] = row[index] ?? null
      })
      if (result.expanded) {
        const expanded: Record<string, unknown> = {}
        for (const [column, resolutions] of Object.entries(result.expanded)) {
          expanded[column] = resolutions[rowIndex] ?? null
        }
        object._expanded = expanded
      }
      return JSON.stringify(object)
    })
    .join('\n')
}

/** Runs exactly one statement and measures client-side (via withCall). */
export async function executeSql(
  apiClient: ApiClient,
  domain: string,
  sql: string,
  expand: string[],
  params: unknown[],
): Promise<SqlOutcome> {
  const body = buildSqlRequest(sql, expand, params)
  let errorBody: unknown
  const { data, call } = await withCall<Record<string, never>>('POST', async () => {
    // Contract `params` are arbitrary JSON values; the generated typing only knows an empty object per entry (as in relRows/referencedBy).
    const response = await apiClient.api.POST('/store-api/rel/{domain}/sql', {
      params: { path: { domain } },
      body: body as unknown as components['schemas']['SqlRequest'],
    })
    errorBody = response.error
    return { data: response.data, response: response.response }
  })

  if (call.status >= 200 && call.status < 300) {
    const result = parseSqlResult(data)
    if (result === undefined) return { status: 'error', call, message: 'unexpected response shape', docId: 'lurasql' }
    const enriched: SqlResult = result.kind === 'ddl' ? { ...result, label: statementLabel(sql) } : result
    return { status: 'ok', call, result: enriched }
  }
  return { status: 'error', call, message: messageFromError(errorBody, call.status), docId: docIdForStatus(call.status) }
}
