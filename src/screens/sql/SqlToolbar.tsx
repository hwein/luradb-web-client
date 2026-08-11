import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ApiClient } from '../../api'
import { relTableDetailQueryOptions, relTablesQueryOptions } from '../../shell/domainDetails'

interface SqlToolbarProps {
  apiClient: ApiClient | undefined
  domainName: string | null
  hasRel: boolean
  /** Spiegelt exakt den Klick-Guard des Screens (canRun) — enabled heißt: der Klick wirkt. */
  runDisabled: boolean
  expand: string[]
  onExpandChange: (expand: string[]) => void
  params: string
  onParamsChange: (params: string) => void
  paramsError: string | undefined
  onRun: () => void
  running: boolean
  docsOpen: boolean
  onToggleDocs: () => void
}

function ExpandFreetext({ onAdd }: { onAdd: (column: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <input
      className="sql-chip sql-chip--input"
      placeholder="+ col"
      aria-label="add expand column"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const trimmed = value.trim()
        if (trimmed === '') return
        onAdd(trimmed)
        setValue('')
      }}
    />
  )
}

/** Toolbar (Prototyp Z. 68–74): Run, Expand-Chips (KVREF/JSONREF/REFERENCES-Spalten der Domäne), Shortcut-Hinweis, docs-Toggle. */
export function SqlToolbar({
  apiClient,
  domainName,
  hasRel,
  runDisabled,
  expand,
  onExpandChange,
  params,
  onParamsChange,
  paramsError,
  onRun,
  running,
  docsOpen,
  onToggleDocs,
}: SqlToolbarProps) {
  const refEnabled = hasRel && domainName !== null
  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domainName ?? '', refEnabled))
  const tables = tablesQuery.data ?? []
  const detailQueries = useQueries({
    queries: tables.map((table) => relTableDetailQueryOptions(apiClient, domainName ?? '', table.name, refEnabled)),
  })

  const availableColumns = [
    ...new Set(
      detailQueries.flatMap((query) => {
        const detail = query.data
        if (!detail) return []
        return detail.columns
          .filter((column) => column.type === 'KVREF' || column.type === 'JSONREF' || column.references != null)
          .map((column) => column.name)
      }),
    ),
  ].sort((a, b) => a.localeCompare(b))

  const allLinks = expand.includes('*')

  function addColumn(column: string): void {
    if (allLinks || expand.includes(column)) return
    onExpandChange([...expand, column])
  }

  function removeColumn(column: string): void {
    onExpandChange(expand.filter((entry) => entry !== column))
  }

  return (
    <div className="sql-toolbar">
      <button type="button" className="sql-toolbar__run" onClick={onRun} disabled={runDisabled || running}>
        ▶ Run
      </button>

      <span className="sql-toolbar__expand-label">expand:</span>

      {allLinks ? (
        <button type="button" className="sql-chip sql-chip--active" aria-label="remove expand *" onClick={() => onExpandChange([])}>
          * <span className="sql-chip__x">×</span>
        </button>
      ) : (
        <>
          {expand.map((column) => (
            <button
              key={column}
              type="button"
              className="sql-chip sql-chip--active"
              aria-label={`remove expand ${column}`}
              onClick={() => removeColumn(column)}
            >
              {column} <span className="sql-chip__x">×</span>
            </button>
          ))}
          {availableColumns
            .filter((column) => !expand.includes(column))
            .map((column) => (
              <button
                key={column}
                type="button"
                className="sql-chip sql-chip--ghost"
                aria-label={`add expand ${column}`}
                onClick={() => addColumn(column)}
              >
                + {column}
              </button>
            ))}
          <button type="button" className="sql-chip sql-chip--ghost" onClick={() => onExpandChange(['*'])}>
            + * all links
          </button>
          <ExpandFreetext onAdd={addColumn} />
        </>
      )}

      <input
        className={`sql-chip sql-chip--input sql-toolbar__params${paramsError ? ' sql-toolbar__params--error' : ''}`}
        aria-label="params"
        aria-invalid={paramsError !== undefined}
        placeholder='params: ["paid", 42]'
        value={params}
        onChange={(event) => onParamsChange(event.target.value)}
      />
      {paramsError && <span className="sql-toolbar__params-error">{paramsError}</span>}

      <span className="sql-toolbar__hint">⌘⏎ run · ⌘S save as view</span>

      <button
        type="button"
        className={`sql-toolbar__docs${docsOpen ? ' sql-toolbar__docs--active' : ''}`}
        aria-pressed={docsOpen}
        onClick={onToggleDocs}
      >
        ◈ docs
      </button>
    </div>
  )
}
