import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { ApiClient } from '../../api'
import {
  createJsonDomain,
  createKvDomain,
  createRelDomain,
  deleteJsonDomain,
  deleteKvDomain,
  deleteRelDomain,
  JSON_DOMAINS_KEY,
  KV_DOMAINS_KEY,
  REL_DOMAINS_KEY,
  useDomainSummaries,
  type DomainSummary,
} from '../../shell/domains'
import { useEngineActivity, type EngineActivity } from '../../shell/engineActivity'
import { runEngineCascade, type Engine } from '../../shell/engineCascade'

const ENGINE_ORDER: Engine[] = ['kv', 'json', 'rel']
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const CREATORS: Record<Engine, (apiClient: ApiClient, name: string) => Promise<void>> = {
  kv: createKvDomain,
  json: createJsonDomain,
  rel: createRelDomain,
}
const DELETERS: Record<Engine, (apiClient: ApiClient, name: string) => Promise<void>> = {
  kv: deleteKvDomain,
  json: deleteJsonDomain,
  rel: deleteRelDomain,
}

function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('domain admin action requires an active connection')
  return apiClient
}

function formatCount(value: number): string {
  return value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`
}

function invalidateDomainLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: KV_DOMAINS_KEY })
  void queryClient.invalidateQueries({ queryKey: JSON_DOMAINS_KEY })
  void queryClient.invalidateQueries({ queryKey: REL_DOMAINS_KEY })
}

/** Ein Dot je Engine nur bei Aktivität (enthält Objekte), nicht bei bloßer Registry-Zugehörigkeit (spec shell/004 §2). */
function EngineDots({ activity }: { activity: EngineActivity }) {
  return (
    <span className="admin-domains__dots">
      {activity.rel === 'active' && <span className="admin-domains__dot admin-domains__dot--rel" title="rel" />}
      {activity.json === 'active' && <span className="admin-domains__dot admin-domains__dot--json" title="json" />}
      {activity.kv === 'active' && <span className="admin-domains__dot admin-domains__dot--kv" title="kv" />}
    </span>
  )
}

interface DomainRowProps {
  apiClient: ApiClient | undefined
  domain: DomainSummary
}

/** Eine Domain-Zeile (spec admin/001 §3, Nachtrag): Dots, belegbare Objektzahl über alle Engines, 🗑 → Inline-Bestätigung → Löschkaskade. */
function DomainRow({ apiClient, domain }: DomainRowProps) {
  const queryClient = useQueryClient()
  const [armed, setArmed] = useState(false)
  const activity = useEngineActivity(apiClient, domain)
  const isDeleting = domain.engines.json?.state === 'deleting' || domain.engines.rel?.state === 'deleting'
  const engines = ENGINE_ORDER.filter((engine) => domain.engines[engine] !== undefined)

  const deleteMutation = useMutation({
    mutationFn: () => runEngineCascade(engines, requireApiClient(apiClient), domain.name, DELETERS),
    onSuccess: (failures) => {
      invalidateDomainLists(queryClient)
      if (failures.length === 0) setArmed(false)
    },
  })

  return (
    <div className="admin-domains__item">
      <div className={`admin-domains__row${isDeleting ? ' admin-domains__row--muted' : ''}`}>
        <span className="admin-domains__name">{domain.name}</span>
        <EngineDots activity={activity} />
        <span className="admin-domains__spacer" />
        {activity.objectCount !== undefined && <span className="admin-domains__count">{formatCount(activity.objectCount)} objects</span>}
        <button type="button" className="admin-domains__trash" title="delete domain" onClick={() => setArmed(true)}>
          🗑
        </button>
      </div>
      {armed && (
        <div className="admin-domains__confirm">
          delete &quot;{domain.name}&quot; from {engines.join('+')}?{' '}
          <button
            type="button"
            className="admin-domains__confirm-action"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            confirm
          </button>{' '}
          ·{' '}
          <button type="button" className="admin-domains__confirm-cancel" onClick={() => setArmed(false)}>
            cancel
          </button>
          {deleteMutation.data && deleteMutation.data.length > 0 && (
            <div className="admin-domains__error">{deleteMutation.data.join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** Inline-Zeile "new domain (max 50 chars)" + Create (spec admin/001 §3, shell/003 §2) — Kaskade läuft immer über alle drei Engines. */
function CreateDomainRow({ apiClient }: { apiClient: ApiClient | undefined }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const nameValid = name.length > 0 && name.length <= 50 && NAME_PATTERN.test(name)

  const createMutation = useMutation({
    mutationFn: () => runEngineCascade(ENGINE_ORDER, requireApiClient(apiClient), name, CREATORS),
    onSuccess: (failures) => {
      invalidateDomainLists(queryClient)
      if (failures.length === 0) setName('')
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!nameValid) return
    createMutation.mutate()
  }

  return (
    <form className="admin-domains__create" onSubmit={handleSubmit}>
      <div className="admin-domains__create-row">
        <input
          className="admin-domains__create-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="new domain (max 50 chars)"
          maxLength={50}
          aria-label="new domain"
        />
        <button type="submit" className="admin-domains__create-submit" disabled={!nameValid || createMutation.isPending}>
          Create
        </button>
      </div>
      {createMutation.data && createMutation.data.length > 0 && <div className="admin-domains__error">{createMutation.data.join(' · ')}</div>}
    </form>
  )
}

/** DOMAINS-Karte (spec admin/001 §3): Liste aus der Explorer-Union (shell/002), Anlage, Löschkaskade, Fußnote. */
export function DomainsCard({ apiClient }: { apiClient: ApiClient | undefined }) {
  const domains = useDomainSummaries(apiClient)

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        DOMAINS<span className="admin-card__head-note">isolated · no cross-domain</span>
      </div>
      {domains.map((domain) => (
        <DomainRow key={domain.name} apiClient={apiClient} domain={domain} />
      ))}
      <CreateDomainRow apiClient={apiClient} />
      <div className="admin-card__footnote admin-card__footnote--tight">
        POST /store-api/domains · duplicate name → 409
        <br />
        delete masks reads instantly, purger sweeps in background
      </div>
    </div>
  )
}
