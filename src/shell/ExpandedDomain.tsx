import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../api'
import { CreateTableModal } from '../screens/sql/CreateTableModal'
import { addTab } from '../screens/sql/sqlStore'
import { jsonDomainDetailQueryOptions, jsonIndexesQueryOptions, relTablesQueryOptions, relViewsQueryOptions } from './domainDetails'
import type { DomainSummary } from './domains'
import { useEngineActivity } from './engineActivity'

interface ExpandedDomainProps {
  domain: DomainSummary
  apiClient: ApiClient | undefined
}

type EngineTone = 'rel' | 'json' | 'kv' | 'dashed'

function EngineChip({ letter, tone }: { letter: string; tone: EngineTone }) {
  return <span className={`explorer__chip explorer__chip--${tone}`}>{letter}</span>
}

function formatCount(value: number): string {
  return value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`
}

function sectionLabelText(base: string, state: string | undefined): string {
  return state === 'deleting' ? `${base} (deleting)` : base
}

function sectionLabelClass(engine: 'rel' | 'json', state: string | undefined): string {
  return state === 'deleting' ? 'explorer__section-label' : `explorer__section-label explorer__section-label--${engine}`
}

function jsonSummaryText(count: number | null | undefined, indexCount: number | undefined): string | undefined {
  if (typeof count !== 'number' || typeof indexCount !== 'number') return undefined
  return `${formatCount(count)} · idx ${indexCount}`
}

/** RELATIONAL/JSON/KEY-VALUE-Abschnitte der genau einen expandierten Domäne (spec shell/002 §3) — Daten nur hier geladen. */
export function ExpandedDomain({ domain, apiClient }: ExpandedDomainProps) {
  const navigate = useNavigate()
  const hasRel = domain.engines.rel !== undefined
  const hasJson = domain.engines.json !== undefined
  const hasKv = domain.engines.kv !== undefined

  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain.name, hasRel))
  const viewsQuery = useQuery(relViewsQueryOptions(apiClient, domain.name, hasRel))
  const jsonDetailQuery = useQuery(jsonDomainDetailQueryOptions(apiClient, domain.name, hasJson))
  const indexesQuery = useQuery(jsonIndexesQueryOptions(apiClient, domain.name, hasJson))
  const activity = useEngineActivity(apiClient, domain)
  const [tableModalOpen, setTableModalOpen] = useState(false)

  function openInData(engine: 'kv' | 'json' | 'rel', table?: string): void {
    const params = new URLSearchParams({ engine })
    if (table !== undefined) params.set('table', table)
    void navigate(`/data?${params.toString()}`)
  }

  /** Views haben keinen Rows-Endpunkt (spec data/003 §4) — Klick geht ehrlich über `/sql` statt den REL-Browser vorzutäuschen. */
  function openViewInSql(view: string): void {
    addTab(`SELECT * FROM ${view} LIMIT 50;`)
    void navigate('/sql')
  }

  const jsonSummary = jsonSummaryText(jsonDetailQuery.data?.document_count, indexesQuery.data?.length)
  const relEmpty = tablesQuery.isSuccess && viewsQuery.isSuccess && (tablesQuery.data?.length ?? 0) === 0 && (viewsQuery.data?.length ?? 0) === 0

  return (
    <>
      <div className="explorer__domain-header">▾ {domain.name}</div>
      <div className="explorer__sections">
        {hasRel && (
          <>
            <div className={sectionLabelClass('rel', domain.engines.rel?.state)}>{sectionLabelText('RELATIONAL', domain.engines.rel?.state)}</div>
            {(tablesQuery.data ?? []).map((table) => (
              <button key={table.name} type="button" className="explorer__object-row" onClick={() => openInData('rel', table.name)}>
                <EngineChip letter="T" tone="rel" /> {table.name}
              </button>
            ))}
            {(viewsQuery.data ?? []).map((view) => (
              <button
                key={view.name}
                type="button"
                className="explorer__object-row explorer__object-row--muted"
                onClick={() => openViewInSql(view.name)}
              >
                <EngineChip letter="V" tone="dashed" /> {view.name}
              </button>
            ))}
            {relEmpty && <div className="explorer__section-placeholder mono-path">no tables yet</div>}
            <button type="button" className="explorer__create-link" onClick={() => setTableModalOpen(true)}>
              + new table
            </button>
          </>
        )}
        {hasJson && (
          <>
            <div className={sectionLabelClass('json', domain.engines.json?.state)}>{sectionLabelText('JSON', domain.engines.json?.state)}</div>
            {activity.json === 'active' && (
              <button type="button" className="explorer__object-row" onClick={() => openInData('json')}>
                <EngineChip letter="J" tone="json" /> documents
                {jsonSummary && <span className="explorer__object-count">{jsonSummary}</span>}
              </button>
            )}
            {activity.json === 'empty' && (
              <>
                <div className="explorer__section-placeholder mono-path">no documents yet</div>
                <button type="button" className="explorer__create-link" onClick={() => openInData('json')}>
                  + new document
                </button>
              </>
            )}
          </>
        )}
        {hasKv && (
          <>
            <div className="explorer__section-label explorer__section-label--kv">KEY-VALUE</div>
            {activity.kv === 'active' && (
              <button type="button" className="explorer__object-row" onClick={() => openInData('kv')}>
                <EngineChip letter="K" tone="kv" /> keys
                {typeof activity.kvKeyCount === 'number' && <span className="explorer__object-count">{formatCount(activity.kvKeyCount)}</span>}
              </button>
            )}
            {activity.kv === 'empty' && (
              <>
                <div className="explorer__section-placeholder mono-path">no keys yet</div>
                <button type="button" className="explorer__create-link" onClick={() => openInData('kv')}>
                  + new key
                </button>
              </>
            )}
          </>
        )}
      </div>
      {tableModalOpen && <CreateTableModal domain={domain} apiClient={apiClient} onClose={() => setTableModalOpen(false)} />}
    </>
  )
}
