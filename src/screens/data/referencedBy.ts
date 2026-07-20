import { useQueries, useQuery } from '@tanstack/react-query'
import { withCall, type ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { relTableDetailQueryOptions, relTablesQueryOptions } from '../../shell/domainDetails'
import { useDomainSummaries } from '../../shell/domains'

type ColumnInfo = components['schemas']['ColumnInfo']

export interface ReferencedByCard {
  table: string
  column: string
  /** `undefined` während die COUNT(*)-Probe noch läuft — Karte zeigt dann einen Platzhalter statt einer Zahl. */
  rowCount: number | undefined
}

/** PK-Spalte für die Probe-Query; ohne markierten PK die erste Spalte (orchestrator-Vorgabe). */
export function primaryKeyColumn(columns: ColumnInfo[]): string | undefined {
  return (columns.find((column) => column.primary_key) ?? columns[0])?.name
}

export interface ReferenceProbeRequest {
  sql: string
  params: unknown[]
}

/** `SELECT COUNT(*) FROM <table> WHERE <col> = ?` — exakter Nutzungs-Count je Kandidat-Spalte (spec 004 §3). */
export function buildReferenceProbeRequest(table: string, column: string, documentKey: string): ReferenceProbeRequest {
  return { sql: `SELECT COUNT(*) FROM ${table} WHERE ${column} = ?`, params: [documentKey] }
}

/** COUNT(*) kommt als SELECT-Shape zurück (`{columns, rows, row_count, limit_applied}`) — der Zählwert steht in `rows[0][0]`, `row_count` wäre hier immer 1. */
export function parseRowCount(data: unknown): number {
  if (typeof data !== 'object' || data === null) return 0
  const rows = (data as Record<string, unknown>).rows
  if (!Array.isArray(rows)) return 0
  const firstRow: unknown = rows[0]
  if (!Array.isArray(firstRow)) return 0
  const count: unknown = firstRow[0]
  return typeof count === 'number' ? count : 0
}

async function probeReference(apiClient: ApiClient, domain: string, table: string, column: string, documentKey: string): Promise<number> {
  const request = buildReferenceProbeRequest(table, column, documentKey)
  const { data } = await withCall<Record<string, never>>('POST', async () => {
    const result = await apiClient.api.POST('/store-api/rel/{domain}/sql', {
      params: { path: { domain } },
      body: request as unknown as components['schemas']['SqlRequest'],
    })
    return { data: result.data, response: result.response }
  })
  return parseRowCount(data)
}

/**
 * JSONREF-Spalten aller rel-Tabellen der Domäne (geteilte rel-tables/-table-detail-Caches, shell/002) —
 * je Spalte eine COUNT(*)-Probe. Jede Kandidat-Spalte liefert eine Karte, auch bei 0 Treffern (spec 004 §3).
 */
export function useReferencedBy(apiClient: ApiClient | undefined, domain: string, documentKey: string | undefined): ReferencedByCard[] {
  const domains = useDomainSummaries(apiClient)
  const hasRel = domains.find((entry) => entry.name === domain)?.engines.rel !== undefined

  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain, hasRel))
  const tables = tablesQuery.data ?? []

  const detailQueries = useQueries({
    queries: tables.map((table) => relTableDetailQueryOptions(apiClient, domain, table.name, hasRel)),
  })

  const jsonrefColumns: { table: string; column: string }[] = []
  detailQueries.forEach((detailQuery, index) => {
    const table = tables[index]
    const detail = detailQuery.data
    if (!table || !detail) return
    for (const column of detail.columns) {
      if (column.type === 'JSONREF') jsonrefColumns.push({ table: table.name, column: column.name })
    }
  })

  const probeQueries = useQueries({
    queries: jsonrefColumns.map(({ table, column }) => ({
      queryKey: ['json-referenced-by', domain, table, column, documentKey ?? ''] as const,
      queryFn: async (): Promise<number> => {
        if (!apiClient || documentKey === undefined) throw new Error('referenced-by query requires an active connection and document key')
        return probeReference(apiClient, domain, table, column, documentKey)
      },
      enabled: apiClient !== undefined && documentKey !== undefined,
    })),
  })

  return jsonrefColumns.map((source, index) => ({ table: source.table, column: source.column, rowCount: probeQueries[index]?.data }))
}
