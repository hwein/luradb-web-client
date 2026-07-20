import { useEffect, useState } from 'react'
import { CallLine } from '../../lib'
import type { SqlOutcome, SqlSelectResult } from './sqlRun'

interface SqlResultsProps {
  outcome: SqlOutcome | undefined
  running: boolean
  onExport: (result: SqlSelectResult) => void
  onOpenDoc: (docId: string) => void
}

function formatValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isDangling(resolution: unknown): boolean {
  return resolution !== null && typeof resolution === 'object' && (resolution as { exists?: unknown }).exists === false
}

function summaryFor(outcome: SqlOutcome): string {
  if (outcome.status === 'error') return 'error'
  switch (outcome.result.kind) {
    case 'select':
      return `${outcome.result.rowCount} rows`
    case 'dml':
      return `${outcome.result.affected} rows affected`
    case 'ddl':
      return 'ok'
  }
}

function docLinkLabel(docId: string): string {
  if (docId === 'lurasql') return '? syntax'
  if (docId === 'cross-engine-links') return 'why?'
  return 'docs'
}

function ExpandedCell({ resolution, onOpenDoc }: { resolution: unknown; onOpenDoc: (docId: string) => void }) {
  if (isDangling(resolution)) {
    return (
      <span className="sql-grid__dangling">
        {'{"exists":false}'} — dangling link ·{' '}
        <button type="button" className="sql-link" onClick={() => onOpenDoc('cross-engine-links')}>
          docs
        </button>
      </span>
    )
  }
  return <span className="sql-grid__expanded-value">{formatValue(resolution)}</span>
}

function ResultGrid({ result, onOpenDoc }: { result: SqlSelectResult; onOpenDoc: (docId: string) => void }) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  useEffect(() => setSelectedRow(null), [result])

  const expandedColumns = result.expanded ? Object.keys(result.expanded) : []

  if (result.rows.length === 0) {
    return <div className="sql-grid__empty">no rows</div>
  }

  return (
    <table className="sql-grid">
      <thead>
        <tr>
          {result.columns.map((column) => (
            <th key={column.name} title={column.type}>
              {column.name}
            </th>
          ))}
          {expandedColumns.map((column) => (
            <th key={`_expanded.${column}`} className="sql-grid__expanded-head">
              _expanded.{column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, rowIndex) => (
          <tr
            // Ergebnis-Rows haben keinen stabilen Schlüssel (Arrays) — der Index ist hier die Identität.
            key={rowIndex}
            className={selectedRow === rowIndex ? 'sql-grid__row--selected' : undefined}
            onClick={() => setSelectedRow(rowIndex)}
          >
            {result.columns.map((column, columnIndex) => (
              <td key={column.name} className={columnIndex === 0 ? 'sql-grid__cell--muted' : undefined}>
                {formatValue(row[columnIndex])}
              </td>
            ))}
            {expandedColumns.map((column) => (
              <td key={`_expanded.${column}`} className="sql-grid__expanded-cell">
                <ExpandedCell resolution={result.expanded?.[column]?.[rowIndex]} onOpenDoc={onOpenDoc} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ResultBody({ outcome, onOpenDoc }: { outcome: SqlOutcome; onOpenDoc: (docId: string) => void }) {
  if (outcome.status === 'error') {
    return (
      <div className="sql-results__error">
        {outcome.message} ·{' '}
        <button type="button" className="sql-link" onClick={() => onOpenDoc(outcome.docId)}>
          {docLinkLabel(outcome.docId)}
        </button>
      </div>
    )
  }
  switch (outcome.result.kind) {
    case 'select':
      return <ResultGrid result={outcome.result} onOpenDoc={onOpenDoc} />
    case 'ddl':
      return <div className="sql-results__confirm">ok · {outcome.result.label}</div>
    case 'dml': {
      const { affected, lastPk } = outcome.result
      const pk = lastPk === null || lastPk === undefined ? '' : ` · last_pk ${formatValue(lastPk)}`
      return (
        <div className="sql-results__confirm">
          {affected} rows affected{pk}
        </div>
      )
    }
  }
}

/** Ergebnis-Panel (spec §5): Kopf mit CallLine + Export, darunter Grid / DDL·DML-Bestätigung / Fehlerzeile. */
export function SqlResults({ outcome, running, onExport, onOpenDoc }: SqlResultsProps) {
  const selectResult = outcome?.status === 'ok' && outcome.result.kind === 'select' ? outcome.result : undefined

  return (
    <div className="sql-results">
      <div className="sql-results__head">
        <span className="sql-results__label mono-label">RESULTS</span>
        {outcome && (
          <span className="sql-results__meta">
            {summaryFor(outcome)} · {outcome.call.ms.toFixed(1)} ms · <CallLine method="POST" path={outcome.call.path} />
            {selectResult?.limitApplied ? ' · limit applied' : ''}
          </span>
        )}
        {selectResult && selectResult.rows.length > 0 && (
          <button type="button" className="sql-results__export" onClick={() => onExport(selectResult)}>
            export ndjson ↓
          </button>
        )}
      </div>
      <div className="sql-results__body">
        {running ? (
          <div className="sql-results__hint">running…</div>
        ) : outcome ? (
          <ResultBody outcome={outcome} onOpenDoc={onOpenDoc} />
        ) : (
          <div className="sql-results__hint">run a query to see results</div>
        )}
      </div>
    </div>
  )
}
