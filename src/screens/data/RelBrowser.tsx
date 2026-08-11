import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { CallLine } from '../../lib'
import { relTableDetailQueryOptions } from '../../shell/domainDetails'
import { useDomainSummaries } from '../../shell/domains'
import { openDocs } from '../docs/openDocs'
import { AlterTableModal } from '../sql/AlterTableModal'
import { DataHeader } from './DataHeader'
import { RelRowDetail, type RelDetailMode } from './RelRowDetail'
import { RelRowsGrid } from './RelRowsGrid'
import { primaryKeyColumn } from './referencedBy'
import { pkValueOf, relFilteredRowsQueryOptions, relRowsQueryOptions, type RelRow } from './relRows'

type ColumnInfo = components['schemas']['ColumnInfo']

interface RelBrowserProps {
  domain: string
  apiClient: ApiClient | undefined
  table: string
  filterCol: string | undefined
  filterVal: string | undefined
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

function refTone(column: ColumnInfo): 'json' | 'kv' | undefined {
  if (column.type === 'JSONREF') return 'json'
  if (column.type === 'KVREF') return 'kv'
  return undefined
}

/** REL-Modus des Data Browsers (spec data/003): Schema-Kopf, Zeilen-Grid mit Expand-Toggle, Row-CRUD, Filter-Ankunft aus Referenced-by. */
export function RelBrowser({ domain, apiClient, table, filterCol, filterVal }: RelBrowserProps) {
  const navigate = useNavigate()
  const filterActive = filterCol !== undefined && filterVal !== undefined

  const [expandOn, setExpandOn] = useState(false)
  const [mode, setMode] = useState<RelDetailMode>({ kind: 'empty' })
  const [alterModalOpen, setAlterModalOpen] = useState(false)

  // Gecachte Liste (Explorer nutzt denselben Query-Key) — nur für die KVREF/JSONREF-Engine-Führung im Alter-Table-Assistenten (spec sql/004 §3).
  const domainSummary = useDomainSummaries(apiClient).find((entry) => entry.name === domain) ?? { name: domain, engines: {} }

  const schemaQuery = useQuery(relTableDetailQueryOptions(apiClient, domain, table, apiClient !== undefined))
  const rowsQuery = useInfiniteQuery(relRowsQueryOptions(apiClient, domain, table, expandOn, !filterActive))
  const filterColType = schemaQuery.data?.columns.find((column) => column.name === filterCol)?.type
  const filteredQuery = useQuery(relFilteredRowsQueryOptions(apiClient, domain, table, filterCol, filterColType, filterVal, filterActive))

  const pages = rowsQuery.data?.pages ?? []
  const unfilteredRows = pages.flatMap((page) => page.rows)
  const lastPage = pages[pages.length - 1]

  const rows: RelRow[] = filterActive ? (filteredQuery.data?.rows ?? []) : unfilteredRows
  const limitApplied = filterActive ? (filteredQuery.data?.limitApplied ?? false) : (lastPage?.limitApplied ?? false)
  const call = filterActive ? filteredQuery.data?.call : lastPage?.call
  const isLoading = filterActive ? filteredQuery.isLoading : rowsQuery.isLoading

  const columns = schemaQuery.data?.columns ?? []
  const pkColumn = primaryKeyColumn(columns)

  // Neuer Tabellen-/Filterkontext ⇒ Auswahl verwerfen, dann greift Auto-Select auf die erste Zeile (Expand-Toggle bleibt bewusst außen vor).
  useEffect(() => {
    setMode({ kind: 'empty' })
  }, [domain, table, filterCol, filterVal])

  const firstRowPk = rows[0] !== undefined && pkColumn !== undefined ? pkValueOf(rows[0], pkColumn) : undefined
  useEffect(() => {
    if (mode.kind === 'empty' && firstRowPk !== undefined) setMode({ kind: 'view', pk: firstRowPk })
  }, [mode, firstRowPk])

  function clearFilter(): void {
    void navigate(`/data?${new URLSearchParams({ engine: 'rel', table }).toString()}`)
  }

  function goToLinkDocs(): void {
    openDocs('cross-engine-links')
    void navigate('/docs')
  }

  // Absprung zum Ziel-Objekt (spec 009 §5): Ankunftsparam analog zur Filter-Ankunft, den KvBrowser/JsonBrowser als initiale Detail-Selektion übernehmen.
  function openLinkedKey(engine: 'json' | 'kv', key: string): void {
    void navigate(`/data?${new URLSearchParams({ engine, key }).toString()}`)
  }

  if (schemaQuery.isLoading) {
    return (
      <div className="data">
        <DataHeader tone="rel" letter="T" path={`${domain} / ${table}`} />
        <div className="data__empty mono-data">loading schema…</div>
      </div>
    )
  }

  if (schemaQuery.isError || schemaQuery.data === undefined) {
    return (
      <div className="data">
        <DataHeader tone="rel" letter="T" path={`${domain} / ${table}`} />
        <div className="data__empty mono-data">failed to load table schema</div>
      </div>
    )
  }

  const indexes = schemaQuery.data.indexes
  const indexPillText = indexes.length > 0 ? `idx: ${indexes.map((index) => index.column).join(', ')}` : 'idx: —'
  const selectedRow = mode.kind === 'view' && pkColumn !== undefined ? rows.find((row) => pkValueOf(row, pkColumn) === mode.pk) : undefined

  return (
    <div className="data">
      <DataHeader tone="rel" letter="T" path={`${domain} / ${table}`} />
      <div className="rel__schema-bar">
        {columns.map((column) => {
          const tone = refTone(column)
          return (
            <span key={column.name} className={`rel__col-chip${tone ? ` rel__col-chip--${tone}` : ''}`}>
              {column.primary_key && (
                <span className="rel__col-chip__pk" aria-hidden="true">
                  ●
                </span>
              )}
              {column.name}·{column.type}
            </span>
          )
        })}
        <span className="data__idx-pill">{indexPillText}</span>
        <button type="button" className="rel__alter-table" onClick={() => setAlterModalOpen(true)}>
          alter table
        </button>
        <button
          type="button"
          className={`rel__expand-toggle${expandOn ? ' rel__expand-toggle--active' : ''}`}
          onClick={() => setExpandOn((value) => !value)}
          disabled={filterActive}
          aria-pressed={expandOn}
        >
          expand
        </button>
      </div>
      {filterActive && (
        <div className="rel__filter-bar mono-data">
          filtered: {filterCol} = {filterVal}{' '}
          <button type="button" className="rel__filter-clear" onClick={clearFilter} aria-label="clear filter">
            ×
          </button>
          {filteredQuery.isError && (
            <span className="rel__filter-error">
              {filteredQuery.error instanceof Error ? filteredQuery.error.message : 'filter query failed'}
            </span>
          )}
        </div>
      )}
      <div className="data__body">
        <RelRowsGrid
          apiClient={apiClient}
          domain={domain}
          table={table}
          columns={columns}
          rows={rows}
          expandOn={expandOn && !filterActive}
          pkColumn={pkColumn}
          selectedPk={mode.kind === 'view' ? mode.pk : undefined}
          onSelect={(pk) => setMode({ kind: 'view', pk })}
          onNew={() => setMode({ kind: 'new' })}
          loading={isLoading}
          hasMore={!filterActive && rowsQuery.hasNextPage}
          loadingMore={!filterActive && rowsQuery.isFetchingNextPage}
          onLoadMore={() => void rowsQuery.fetchNextPage()}
          onOpenDoc={goToLinkDocs}
        />
        <RelRowDetail
          // Remount je Modus/Zeile setzt Edit-/Bestätigungs-Zustände zurück (statt eines Reset-Effects, der mit schnellen Folge-Klicks racte).
          key={mode.kind === 'view' ? `view:${mode.pk}` : mode.kind}
          domain={domain}
          apiClient={apiClient}
          table={table}
          columns={columns}
          mode={mode}
          row={selectedRow}
          onCreated={(pk) => setMode({ kind: 'view', pk })}
          onDeleted={() => setMode({ kind: 'empty' })}
          onClear={() => setMode({ kind: 'empty' })}
          onConflictDocs={goToLinkDocs}
          onOpenLink={openLinkedKey}
        />
      </div>
      <div className="data__footer mono-path">
        {call !== undefined ? (
          <>
            {formatNumber(rows.length)} rows{limitApplied ? ' · limit applied' : ''} ·{' '}
            <CallLine method={call.method} path={call.path} note={call.bodyNote} />
          </>
        ) : isLoading ? (
          'loading…'
        ) : null}
      </div>
      {alterModalOpen && (
        <AlterTableModal
          domain={domainSummary}
          apiClient={apiClient}
          table={table}
          schema={schemaQuery.data}
          onClose={() => setAlterModalOpen(false)}
        />
      )}
    </div>
  )
}
