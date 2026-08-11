import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { ApiError, withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'
import { executeSql, messageFromError, parseSqlResult, type SqlSelectResult } from '../sql/sqlRun'
import { primaryKeyColumn } from './referencedBy'

type ColumnInfo = components['schemas']['ColumnInfo']
type RowsResponse = components['schemas']['RowsResponse']

const ROWS_PAGE_SIZE = 50

export type RelRow = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRow(value: unknown): RelRow {
  return isRecord(value) ? value : {}
}

export function pkValueOf(row: RelRow, pkColumn: string): string {
  const value = row[pkColumn]
  return value === null || value === undefined ? '' : String(value)
}

/** `_expanded`-Block einer Zeile (spec §2) — je Spalte eine Resolution wie `{"exists":true,"value":…}`. */
export function expandedOf(row: RelRow): Record<string, unknown> | undefined {
  const value = row._expanded
  return isRecord(value) ? value : undefined
}

/** Live geprüft (rel/{d}/tables/{t}/rows?expand=*): dangling ist `{"exists":false, …}`, unabhängig vom REF-Typ. */
export function isDangling(resolution: unknown): boolean {
  return isRecord(resolution) && resolution.exists === false
}

export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function withQuery(path: string, query: Record<string, string | number>): string {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
  return `${path}?${search}`
}

export interface RelRowsPage {
  rows: RelRow[]
  offset: number
  limitApplied: boolean
  call: CallMeta
}

async function fetchRowsPage(apiClient: ApiClient, domain: string, table: string, expand: boolean, offset: number): Promise<RelRowsPage> {
  const query: { limit: number; offset: number; expand?: string } = { limit: ROWS_PAGE_SIZE, offset }
  if (expand) query.expand = '*'
  const { data, call } = await withCall<RowsResponse>('GET', async () => {
    const result = await apiClient.api.GET('/store-api/rel/{domain}/tables/{table}/rows', {
      params: { path: { domain, table }, query },
    })
    return { data: result.data, response: result.response }
  })
  if (data === undefined) throw new ApiError(0, 'failed to load rows')
  return {
    rows: data.rows.map(normalizeRow),
    offset: data.offset,
    limitApplied: data.limit_applied,
    call: { ...call, path: withQuery(call.path, query) },
  }
}

/** Zeilen-Grid (spec §2): `GET rows` mit limit 50, offset-Paging — `limit_applied` (nicht `row_count`, der ist seitenlokal, live geprüft) sagt, ob noch mehr Zeilen folgen. */
export function relRowsQueryOptions(apiClient: ApiClient | undefined, domain: string, table: string, expand: boolean, enabled: boolean) {
  return infiniteQueryOptions({
    queryKey: ['rel-rows', domain, table, expand] as const,
    queryFn: async ({ pageParam }): Promise<RelRowsPage> => {
      if (!apiClient) throw new Error('rel rows query requires an active connection')
      return fetchRowsPage(apiClient, domain, table, expand, pageParam)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.limitApplied ? lastPage.offset + lastPage.rows.length : undefined),
    enabled: enabled && apiClient !== undefined,
  })
}

export interface RelFilteredRows {
  rows: RelRow[]
  limitApplied: boolean
  call: CallMeta
}

function rowsToObjects(result: SqlSelectResult): RelRow[] {
  return result.rows.map((row) => {
    const object: RelRow = {}
    result.columns.forEach((column, index) => {
      object[column.name] = row[index] ?? null
    })
    return object
  })
}

/**
 * Filter-Ankunft (spec §5): `SELECT * FROM t WHERE col = ? LIMIT 50` über `/sql`, damit der Filter serverseitig gilt;
 * Array-Zeilen auf die Objektform des Grids normalisiert. Der URL-Wert wird nach Spaltentyp koerziert — als String-Param
 * an einer INTEGER-Spalte (PK-Absprung aus dem Dangling-Report, spec 004 §4) antwortet der Server sonst 400 TypeMismatch;
 * bis der Typ aus dem Schema vorliegt, bleibt die Query disabled.
 */
export function relFilteredRowsQueryOptions(
  apiClient: ApiClient | undefined,
  domain: string,
  table: string,
  filterCol: string | undefined,
  filterColType: string | undefined,
  filterVal: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: ['rel-rows-filtered', domain, table, filterCol ?? '', filterVal ?? ''] as const,
    queryFn: async (): Promise<RelFilteredRows> => {
      if (!apiClient || filterCol === undefined || filterColType === undefined || filterVal === undefined) {
        throw new Error('filtered rel rows query requires an active connection, filterCol with type and filterVal')
      }
      const body = { sql: `SELECT * FROM ${table} WHERE ${filterCol} = ? LIMIT ${ROWS_PAGE_SIZE}`, params: [parseColumnValue(filterColType, filterVal)] }
      let errorBody: unknown
      const { data, call } = await withCall<Record<string, never>>(
        'POST',
        async () => {
          const result = await apiClient.api.POST('/store-api/rel/{domain}/sql', {
            params: { path: { domain } },
            body: body as unknown as components['schemas']['SqlRequest'],
          })
          errorBody = result.error
          return { data: result.data, response: result.response }
        },
        `body ${JSON.stringify(body)}`,
      )
      const result = parseSqlResult(data)
      if (result === undefined || result.kind !== 'select') {
        throw new ApiError(call.status, messageFromError(errorBody, call.status))
      }
      return { rows: rowsToObjects(result), limitApplied: result.limitApplied, call }
    },
    enabled: enabled && apiClient !== undefined && filterCol !== undefined && filterColType !== undefined && filterVal !== undefined,
  })
}

async function mutateRow<T>(fn: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T | undefined> {
  const result = await fn()
  if (!result.response.ok) throw new ApiError(result.response.status, messageFromError(result.error, result.response.status))
  return result.data
}

export interface RowWriteResult {
  affected: number
  lastPk: unknown
}

function toWriteResult(data: unknown): RowWriteResult {
  const record = isRecord(data) ? data : {}
  return { affected: typeof record.affected === 'number' ? record.affected : 0, lastPk: record.last_pk ?? null }
}

/** `POST …/rows` (spec §3): autoincrement-PK bleibt im Payload weg. Antwort ist `{affected,last_pk}`, nie die volle Zeile (live geprüft). */
export async function insertRow(apiClient: ApiClient, domain: string, table: string, payload: Record<string, unknown>): Promise<RowWriteResult> {
  const data = await mutateRow(() =>
    apiClient.api.POST('/store-api/rel/{domain}/tables/{table}/rows', {
      params: { path: { domain, table } },
      body: payload as Record<string, never>,
    }),
  )
  return toWriteResult(data)
}

/** `PUT …/rows/{pk}` — Teil-Update: nur die im Body genannten Spalten ändern sich (live geprüft, PK nie im Payload). */
export async function updateRow(apiClient: ApiClient, domain: string, table: string, pk: string, payload: Record<string, unknown>): Promise<void> {
  await mutateRow(() =>
    apiClient.api.PUT('/store-api/rel/{domain}/tables/{table}/rows/{pk}', {
      params: { path: { domain, table, pk } },
      body: payload as Record<string, never>,
    }),
  )
}

export async function deleteRow(apiClient: ApiClient, domain: string, table: string, pk: string): Promise<void> {
  await mutateRow(() =>
    apiClient.api.DELETE('/store-api/rel/{domain}/tables/{table}/rows/{pk}', {
      params: { path: { domain, table, pk } },
    }),
  )
}

/** Link-Validierungsfehler (KVREF/JSONREF-Ziel fehlt) antworten laut Contract 409 (spec §3). */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

export interface FieldState {
  text: string
  isNull: boolean
}

export type RowFormState = Record<string, FieldState>

function cellText(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function blankFormState(columns: ColumnInfo[]): RowFormState {
  const state: RowFormState = {}
  for (const column of columns) state[column.name] = { text: '', isNull: false }
  return state
}

export function formStateFromRow(columns: ColumnInfo[], row: RelRow): RowFormState {
  const state: RowFormState = {}
  for (const column of columns) {
    const value = row[column.name]
    state[column.name] = { text: value === null || value === undefined ? '' : cellText(value), isNull: value === null }
  }
  return state
}

function isNumericType(type: string): boolean {
  return type === 'INTEGER' || type === 'REAL'
}

/** Unparsbare Zahl-Eingabe geht als Text durch (statt `NaN`→`null` zu riskieren) — der Server antwortet dann mit einer klaren Typ-Fehlermeldung. */
export function parseColumnValue(type: string, text: string): unknown {
  if (!isNumericType(type)) return text
  const parsed = Number(text)
  return Number.isNaN(parsed) ? text : parsed
}

/** Formular → Payload (spec §3/orchestrator): leer ⇒ weglassen, `null`-Schalter ⇒ `null`, PK bei Update nie im Body, autoincrement-PK bei Insert nie im Body. */
export function buildRowPayload(columns: ColumnInfo[], form: RowFormState, mode: 'insert' | 'update'): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const column of columns) {
    if (mode === 'update' && column.primary_key) continue
    if (mode === 'insert' && column.primary_key && column.autoincrement) continue
    const field = form[column.name]
    if (field === undefined) continue
    if (column.nullable && field.isNull) {
      payload[column.name] = null
      continue
    }
    if (field.text.trim() === '') continue
    payload[column.name] = parseColumnValue(column.type, field.text)
  }
  return payload
}

/** Link-Spalten fürs Dangling-Reporting (spec 004 §4): KVREF/JSONREF (cross-engine) und REFERENCES (rel→rel-FK, erkennbar an `references`). */
export function isLinkColumn(column: ColumnInfo): boolean {
  return column.type === 'KVREF' || column.type === 'JSONREF' || column.references != null
}

export interface DanglingLinkEntry {
  pk: string
  column: string
}

export interface DanglingLinksReport {
  entries: DanglingLinkEntry[]
  checked: number
  truncated: boolean
}

/** `max_limit` laut api/LURASQL.md — mehr kann ein einzelnes SELECT ohnehin nicht liefern. */
const DANGLING_CHECK_LIMIT = 10000

/**
 * Toolbar-Report "check links" (spec 004 §4): ein SELECT über PK + Link-Spalten mit `expand`.
 * Auflösungs-Formen via /sql (live vermessen): KVREF/JSONREF dangling ⇒ `{exists:false,…}`; REFERENCES
 * valide ⇒ Zielzeile ohne `exists`-Feld, dangling ⇒ `null`; NULL-Zelle ⇒ ebenfalls `null` (beide Typen).
 * Dangling ist eine Auflösung daher nur bei non-null Zellwert UND (Auflösung null ODER `exists:false`).
 */
export async function checkDanglingLinks(
  apiClient: ApiClient,
  domain: string,
  table: string,
  columns: ColumnInfo[],
): Promise<DanglingLinksReport> {
  const pk = primaryKeyColumn(columns)
  const linkColumns = columns.filter(isLinkColumn).map((column) => column.name)
  if (pk === undefined || linkColumns.length === 0) return { entries: [], checked: 0, truncated: false }

  // PK kann selbst Link-Spalte sein (REFERENCES-PK) — nicht doppelt projizieren.
  const sql = `SELECT ${[pk, ...linkColumns.filter((column) => column !== pk)].join(', ')} FROM ${table} LIMIT ${DANGLING_CHECK_LIMIT}`
  const outcome = await executeSql(apiClient, domain, sql, linkColumns, [])
  if (outcome.status === 'error') throw new ApiError(outcome.call.status, outcome.message)
  const result = outcome.result
  if (result.kind !== 'select') throw new ApiError(outcome.call.status, 'unexpected dangling-check response shape')

  const pkIndex = result.columns.findIndex((column) => column.name === pk)
  const columnIndexes = new Map(linkColumns.map((column) => [column, result.columns.findIndex((c) => c.name === column)]))
  const entries: DanglingLinkEntry[] = []
  result.rows.forEach((row, rowIndex) => {
    const pkValue = pkIndex >= 0 ? row[pkIndex] : undefined
    for (const column of linkColumns) {
      const cellIndex = columnIndexes.get(column) ?? -1
      const cell = cellIndex >= 0 ? row[cellIndex] : undefined
      if (cell === null || cell === undefined) continue
      // Nur explizite Evidenz zählt (JSON-`null` bzw. `exists:false`) — eine fehlende Auflösung ist kein Befund.
      const resolution = result.expanded?.[column]?.[rowIndex]
      if (resolution === null || isDangling(resolution)) {
        entries.push({ pk: pkValue === null || pkValue === undefined ? '' : String(pkValue), column })
      }
    }
  })

  return { entries, checked: result.rows.length, truncated: result.limitApplied || result.rows.length >= DANGLING_CHECK_LIMIT }
}
