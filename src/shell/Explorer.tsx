import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../api'
import { useSession } from '../app/session'
import { CreateDomainForm } from './CreateDomainForm'
import { DomainLinksPanel } from './DomainLinksPanel'
import { useDomainSummaries, useDomainsPending, type DomainSummary } from './domains'
import './Explorer.css'
import { ExpandedDomain } from './ExpandedDomain'
import { useEngineActivity, type EngineActivityLevel } from './engineActivity'
import { useSelectedDomain } from './SelectedDomainContext'

function tagFor(name: string, state: string | undefined): string {
  return state === 'deleting' ? `${name} (deleting)` : name
}

/** Ein Tag erscheint bei Aktivität (enthält Objekte) oder `state === 'deleting'` — der Zustands-Hinweis geht nie verloren (spec shell/004 §3). */
function shouldTagEngine(state: string | undefined, level: EngineActivityLevel | undefined): boolean {
  return state === 'deleting' || level === 'active'
}

function CollapsedDomainRow({ domain, apiClient, onSelect }: { domain: DomainSummary; apiClient: ApiClient | undefined; onSelect: () => void }) {
  const activity = useEngineActivity(apiClient, domain)
  const tags = [
    domain.engines.rel && shouldTagEngine(domain.engines.rel.state, activity.rel) && tagFor('rel', domain.engines.rel.state),
    domain.engines.json && shouldTagEngine(domain.engines.json.state, activity.json) && tagFor('json', domain.engines.json.state),
    domain.engines.kv && activity.kv === 'active' && 'kv',
  ].filter((tag): tag is string => Boolean(tag))

  return (
    <button type="button" className="explorer__domain-row" onClick={onSelect}>
      <span>▸ {domain.name}</span>
      <span className="explorer__engine-tags">{tags.join(' · ')}</span>
    </button>
  )
}

function DocsSearchButton() {
  const navigate = useNavigate()
  return (
    <button type="button" className="explorer__docs-button" onClick={() => void navigate('/docs', { state: { focusSearch: true } })}>
      ◈ search docs
      <span className="explorer__docs-shortcut">F1</span>
    </button>
  )
}

/** Persistente Explorer-Spalte (spec shell/002): Domänenliste mit Engine-Sektionen, Links-Panel, Domain-Anlage, Docs-Suche. */
export function Explorer() {
  const session = useSession()
  const apiClient: ApiClient | undefined = session.status === 'connected' ? session.apiClient : undefined
  const domains = useDomainSummaries(apiClient)
  const domainsPending = useDomainsPending(apiClient)
  const { selected, select } = useSelectedDomain()
  const [creating, setCreating] = useState(false)

  const selectedDomain = domains.find((domain) => domain.name === selected)

  return (
    <>
      <div className="explorer__label">DOMAINS</div>
      {domains.map((domain) =>
        domain.name === selected ? (
          <ExpandedDomain key={domain.name} domain={domain} apiClient={apiClient} />
        ) : (
          <CollapsedDomainRow key={domain.name} domain={domain} apiClient={apiClient} onSelect={() => select(domain.name)} />
        ),
      )}
      {domains.length === 0 && !domainsPending && (
        <div className="explorer__empty-hint">
          <span className="mono-path">no domains yet</span>
          <span className="mono-path">create one to get started</span>
        </div>
      )}
      {creating ? (
        <CreateDomainForm apiClient={apiClient} onClose={() => setCreating(false)} />
      ) : (
        <button type="button" className="explorer__create-link" onClick={() => setCreating(true)}>
          + create domain
        </button>
      )}
      {selectedDomain && <DomainLinksPanel apiClient={apiClient} domain={selectedDomain} />}
      <div className="explorer__spacer" />
      <DocsSearchButton />
    </>
  )
}
