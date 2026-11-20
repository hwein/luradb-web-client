import { useQueries, useQuery } from '@tanstack/react-query'
import { withCall, type ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { relTableDetailQueryOptions, relTablesQueryOptions } from '../../shell/domainDetails'

type ColumnInfo = components['schemas']['ColumnInfo']

export interface ReferencedByCard {
  table: string
  column: string
  /** `undefined` while the COUNT(*) probe is running; the card then shows a placeholder instead of a number. */
  rowCount: number | undefined
}

/** PK column for the probe query; the first column when no PK is marked. */
export function primaryKeyColumn(columns: ColumnInfo[]): string | undefined {
  return (columns.find((column) => column.primary_key) ?? columns[0])?.name
}

export interface ReferenceProbeRequest {
  sql: string
  params: unknown[]
}

/** `SELECT COUNT(*) FROM <table> WHERE <col> = ?`: the exact usage count per candidate column. */
export function buildReferenceProbeRequest(table: string, column: string, documentKey: string): ReferenceProbeRequest {
  return { sql: `SELECT COUNT(*) FROM ${table} WHERE ${column} = ?`, params: [documentKey] }
}

/** COUNT(*) returns a SELECT shape (`{columns, rows, row_count, limit_applied}`); the count is in `rows[0][0]`, `row_count` would always be 1. */
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
 * JSONREF columns of all rel tables of the domain (shared rel-tables/-table-detail caches),
 * one COUNT(*) probe per column. Every candidate column yields a card, even with 0 hits.
 */
export function useReferencedBy(apiClient: ApiClient | undefined, domain: string, documentKey: string | undefined): ReferencedByCard[] {
  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain, true))
  const tables = tablesQuery.data ?? []

  const detailQueries = useQueries({
    queries: tables.map((table) => relTableDetailQueryOptions(apiClient, domain, table.name, true)),
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
