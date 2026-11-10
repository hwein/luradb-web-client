import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ApiError, type ApiClient } from '../../api'
import { createDomain, deleteDomain, DOMAINS_KEY, domainsQueryOptions, useDomainSummaries, type DomainSummary } from '../../shell/domains'
import { useEngineActivity, type EngineActivity } from '../../shell/engineActivity'

export const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/** Geteilt mit UsersCard/BackupsCard (spec admin/005 §1) — eine Guard-Funktion statt dreifacher Kopie. */
export function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('admin action requires an active connection')
  return apiClient
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : 'request failed'
}

function formatCount(value: number): string {
  return value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`
}

export function invalidateDomainLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: DOMAINS_KEY })
}

/** One dot per engine only when it holds objects (spec shell/004 §2). */
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

/** One domain row (spec admin/001 §3, addendum): dots, object count over all engines, 🗑 → inline confirm → one DELETE. */
function DomainRow({ apiClient, domain }: DomainRowProps) {
  const queryClient = useQueryClient()
  const [armed, setArmed] = useState(false)
  const activity = useEngineActivity(apiClient, domain)

  const deleteMutation = useMutation({
    mutationFn: () => deleteDomain(requireApiClient(apiClient), domain.name),
    onSuccess: () => {
      invalidateDomainLists(queryClient)
      setArmed(false)
    },
  })

  return (
    <div className="admin-domains__item">
      <div className="admin-domains__row">
        <span className="admin-domains__name" title={domain.name}>
          {domain.name}
        </span>
        <EngineDots activity={activity} />
        <span className="admin-domains__spacer" />
        {activity.objectCount !== undefined && <span className="admin-domains__count">{formatCount(activity.objectCount)} objects</span>}
        <button type="button" className="admin-domains__trash" title="delete domain" onClick={() => setArmed(true)}>
          🗑
        </button>
      </div>
      {armed && (
        <div className="admin-domains__confirm">
          delete &quot;{domain.name}&quot; with its keys, documents, tables and views?{' '}
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
          {deleteMutation.error && <div className="admin-domains__error">{messageOf(deleteMutation.error)}</div>}
        </div>
      )}
    </div>
  )
}

/** Inline row "new domain (max 50 chars)" + Create (spec admin/001 §3, shell/003 §2): one POST. */
function CreateDomainRow({ apiClient }: { apiClient: ApiClient | undefined }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const nameValid = name.length > 0 && name.length <= 50 && NAME_PATTERN.test(name)

  const createMutation = useMutation({
    mutationFn: () => createDomain(requireApiClient(apiClient), name),
    onSuccess: () => {
      invalidateDomainLists(queryClient)
      setName('')
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
      {createMutation.error && <div className="admin-domains__error">{messageOf(createMutation.error)}</div>}
    </form>
  )
}

/** DOMAINS card (spec admin/001 §3): the Explorer's domain list (shell/002), create, delete, footnote. */
export function DomainsCard({ apiClient }: { apiClient: ApiClient | undefined }) {
  const domains = useDomainSummaries(apiClient)
  // Same query options as useDomainSummaries (shared cache, no extra request) — only for the error line (spec admin/005 §2).
  const listError = useQuery(domainsQueryOptions(apiClient)).error

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        DOMAINS<span className="admin-card__head-note">isolated · no cross-domain</span>
      </div>
      {listError && <div className="admin-domains__query-error">domains unavailable — {messageOf(listError)}</div>}
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
