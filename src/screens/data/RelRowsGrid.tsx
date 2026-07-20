import type { ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { DanglingReport } from './DanglingReport'
import { expandedOf, formatCellValue, isDangling, pkValueOf, type RelRow } from './relRows'

type ColumnInfo = components['schemas']['ColumnInfo']

interface RelRowsGridProps {
  apiClient: ApiClient | undefined
  domain: string
  table: string
  columns: ColumnInfo[]
  rows: RelRow[]
  expandOn: boolean
  pkColumn: string | undefined
  selectedPk: string | undefined
  onSelect: (pk: string) => void
  onNew: () => void
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onOpenDoc: () => void
}

function refTone(column: ColumnInfo): 'json' | 'kv' | undefined {
  if (column.type === 'JSONREF') return 'json'
  if (column.type === 'KVREF') return 'kv'
  return undefined
}

function ExpandedCell({ resolution, onOpenDoc }: { resolution: unknown; onOpenDoc: () => void }) {
  if (isDangling(resolution)) {
    return (
      <span className="rel-grid__dangling">
        {'{"exists":false}'} — dangling link ·{' '}
        <button
          type="button"
          className="rel-grid__doc-link"
          onClick={(event) => {
            event.stopPropagation()
            onOpenDoc()
          }}
        >
          docs
        </button>
      </span>
    )
  }
  return <span className="rel-grid__expanded-value">{formatCellValue(resolution)}</span>
}

/** Zeilen-Grid (spec §2): Spaltenreihenfolge aus TableDetail.columns, `_expanded`-Zusatzspalten im Farbton des Ziel-Engines, Dangling muted + Docs-Link. */
export function RelRowsGrid({
  apiClient,
  domain,
  table,
  columns,
  rows,
  expandOn,
  pkColumn,
  selectedPk,
  onSelect,
  onNew,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenDoc,
}: RelRowsGridProps) {
  const refColumns = columns.filter((column) => refTone(column) !== undefined)
  const expandedColumns = expandOn ? refColumns : []

  return (
    <div className="rel-list">
      <div className="rel-list__head">
        <span>rows</span>
        <span className="rel-list__head-actions">
          <DanglingReport apiClient={apiClient} domain={domain} table={table} columns={columns} />
          <button type="button" className="rel-list__new" onClick={onNew}>
            + new row
          </button>
        </span>
      </div>
      <div className="rel-list__scroll">
        {loading ? (
          <div className="rel-list__hint">loading…</div>
        ) : rows.length === 0 ? (
          <div className="rel-list__hint">no rows</div>
        ) : (
          <table className="rel-grid">
            <thead>
              <tr>
                {columns.map((column) => {
                  const tone = refTone(column)
                  return (
                    <th key={column.name} title={column.type} className={tone ? `rel-grid__col-head--${tone}` : undefined}>
                      {column.name}
                    </th>
                  )
                })}
                {expandedColumns.map((column) => (
                  <th key={`_expanded.${column.name}`} className={`rel-grid__expanded-head rel-grid__expanded-head--${refTone(column)}`}>
                    _expanded.{column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pk = pkColumn !== undefined ? pkValueOf(row, pkColumn) : undefined
                const expanded = expandedOf(row)
                return (
                  <tr
                    key={pk ?? JSON.stringify(row)}
                    className={pk !== undefined && pk === selectedPk ? 'rel-grid__row--selected' : undefined}
                    onClick={() => pk !== undefined && onSelect(pk)}
                  >
                    {columns.map((column) => (
                      <td key={column.name} className={column.name === pkColumn ? 'rel-grid__cell--muted' : undefined}>
                        {formatCellValue(row[column.name])}
                      </td>
                    ))}
                    {expandedColumns.map((column) => (
                      <td key={`_expanded.${column.name}`} className="rel-grid__expanded-cell">
                        <ExpandedCell resolution={expanded?.[column.name]} onOpenDoc={onOpenDoc} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {hasMore && (
        <button type="button" className="rel-list__load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'loading…' : 'load more'}
        </button>
      )}
    </div>
  )
}
