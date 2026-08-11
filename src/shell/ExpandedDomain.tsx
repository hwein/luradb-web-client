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

function jsonSummaryText(count: number | null | undefined, indexCount: number | undefined): string | undefined {
  if (typeof count !== 'number' || typeof indexCount !== 'number') return undefined
  return `${formatCount(count)} · idx ${indexCount}`
}

/** Eine Zeile je Engine: Farb-Punkt + muted Label + rechtsbündiger `+`, in jeder Aktivitätsstufe sichtbar (spec shell/006 §2/§3). */
function SectionLabel({ tone, text, addLabel, onAdd }: { tone: 'rel' | 'json' | 'kv'; text: string; addLabel: string; onAdd: () => void }) {
  return (
    <div className="explorer__section-label-row">
      <span className={`explorer__section-dot explorer__section-dot--${tone}`} />
      <span className="explorer__section-label">{text}</span>
      <button type="button" className="explorer__section-add" title={addLabel} aria-label={addLabel} onClick={onAdd}>
        +
      </button>
    </div>
  )
}

/** RELATIONAL/JSON/KEY-VALUE-Abschnitte der genau einen expandierten Domäne (spec shell/002 §3) — Daten nur hier geladen. */
export function ExpandedDomain({ domain, apiClient }: ExpandedDomainProps) {
  const navigate = useNavigate()
  const hasRel = domain.engines.rel !== undefined
  const hasJson = domain.engines.json !== undefined
  const hasKv = domain.engines.kv !== undefined

  const tablesQuery = useQuery({ ...relTablesQueryOptions(apiClient, domain.name, hasRel), refetchInterval: 30_000 })
  const viewsQuery = useQuery({ ...relViewsQueryOptions(apiClient, domain.name, hasRel), refetchInterval: 30_000 })
  const jsonDetailQuery = useQuery({ ...jsonDomainDetailQueryOptions(apiClient, domain.name, hasJson), refetchInterval: 30_000 })
  const indexesQuery = useQuery({ ...jsonIndexesQueryOptions(apiClient, domain.name, hasJson), refetchInterval: 30_000 })
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

  return (
    <>
      <div className="explorer__domain-card">
        <div className="explorer__domain-header">
          <span className="explorer__domain-chevron">▾</span> {domain.name}
        </div>
        <div className="explorer__sections">
          {hasRel && (
            <>
              <SectionLabel
                tone="rel"
                text={sectionLabelText('RELATIONAL', domain.engines.rel?.state)}
                addLabel="new table"
                onAdd={() => setTableModalOpen(true)}
              />
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
            </>
          )}
          {hasJson && (
            <>
              <SectionLabel
                tone="json"
                text={sectionLabelText('JSON', domain.engines.json?.state)}
                addLabel="new document"
                onAdd={() => openInData('json')}
              />
              {activity.json === 'active' && (
                <button type="button" className="explorer__object-row" onClick={() => openInData('json')}>
                  <EngineChip letter="J" tone="json" /> documents
                  {jsonSummary && <span className="explorer__object-count">{jsonSummary}</span>}
                </button>
              )}
            </>
          )}
          {hasKv && (
            <>
              <SectionLabel tone="kv" text="KEY-VALUE" addLabel="new key" onAdd={() => openInData('kv')} />
              {activity.kv === 'active' && (
                <button type="button" className="explorer__object-row" onClick={() => openInData('kv')}>
                  <EngineChip letter="K" tone="kv" /> keys
                  {typeof activity.kvKeyCount === 'number' && <span className="explorer__object-count">{formatCount(activity.kvKeyCount)}</span>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {tableModalOpen && <CreateTableModal domain={domain} apiClient={apiClient} onClose={() => setTableModalOpen(false)} />}
    </>
  )
}
