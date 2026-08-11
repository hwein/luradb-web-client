import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import type { ApiClient } from '../../api'
import { updateReindexTaskStatus, useReindexTasks, type ReindexTask } from '../../lib/tasks'
import { jsonIndexesQueryOptions } from '../../shell/domainDetails'
import { jsonDomainsQueryOptions } from '../../shell/domains'
import { formatNumber } from './format'
import type { SystemMetrics } from './metrics'
import { reindexStatusQueryOptions } from './reindexPoll'
import { startReindex, type StartReindexOutcome } from './reindexStart'

interface TasksJobsCardProps {
  apiClient: ApiClient | undefined
  system: SystemMetrics | undefined
}

/** Pollt den Status eines einzelnen Tasks alle 2s, solange er `running` ist; kein eigenes Markup. */
function ReindexTaskPoller({ apiClient, task }: { apiClient: ApiClient | undefined; task: ReindexTask }) {
  const enabled = apiClient !== undefined && task.status.kind === 'running'
  const query = useQuery(reindexStatusQueryOptions(apiClient, task.domain, task.taskId, enabled))

  useEffect(() => {
    if (query.data !== undefined) updateReindexTaskStatus(task.taskId, query.data)
  }, [query.data, task.taskId])

  return null
}

function progressPercent(processed: number, totalEstimated: number): number {
  if (totalEstimated <= 0) return 0
  return Math.min(100, Math.round((processed / totalEstimated) * 100))
}

function ReindexTaskRow({ task }: { task: ReindexTask }) {
  const shortId = task.taskId.slice(0, 8)
  const label = `reindex ${task.domain}`
  const { status } = task

  if (status.kind === 'running') {
    const pct = progressPercent(status.processed, status.totalEstimated)
    return (
      <div className="engines__task-row">
        <span className="engines__dot engines__dot--warn" />
        <span className="engines__task-label">{label}</span>
        <span className="engines__task-meta">
          running · {pct}% · {shortId}
        </span>
        <span className="engines__task-bar">
          <span className="engines__task-bar-fill" style={{ width: `${pct}%` }} />
        </span>
      </div>
    )
  }
  if (status.kind === 'completed') {
    return (
      <div className="engines__task-row">
        <span className="engines__dot engines__dot--ok" />
        <span className="engines__task-label">{label}</span>
        <span className="engines__task-meta">
          completed · {formatNumber(status.processed)} docs · {status.durationSecs}s
        </span>
      </div>
    )
  }
  return (
    <div className="engines__task-row">
      <span className="engines__dot engines__dot--err" />
      <span className="engines__task-label">{label}</span>
      <span className="engines__task-meta">failed · {status.error}</span>
    </div>
  )
}

const ALL_INDEXES = ''

interface ReindexFormVars {
  apiClient: ApiClient
  domain: string
  field: string
}

/** Inline-Trigger (spec engines/002 §2/§3): Domäne + optionales Feld aus dem geteilten Index-Cache, Start über `startReindex`. */
function ReindexTriggerForm({ apiClient, domains, onClose }: { apiClient: ApiClient; domains: string[]; onClose: () => void }) {
  const [domain, setDomain] = useState(domains[0] ?? '')
  const [field, setField] = useState(ALL_INDEXES)
  const indexesQuery = useQuery(jsonIndexesQueryOptions(apiClient, domain, domain !== ''))
  const fields = indexesQuery.data?.map((index) => index.field) ?? []

  const mutation = useMutation<StartReindexOutcome, Error, ReindexFormVars>({
    mutationFn: (vars) => startReindex(vars.apiClient, vars.domain, vars.field === ALL_INDEXES ? undefined : vars.field),
    onSuccess: (outcome) => {
      if (outcome.status === 'ok') onClose()
    },
  })

  function handleDomainChange(next: string): void {
    setDomain(next)
    setField(ALL_INDEXES)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (domain === '') return
    mutation.mutate({ apiClient, domain, field })
  }

  const errorMessage = mutation.data?.status === 'error' ? mutation.data.message : undefined

  return (
    <form className="engines__reindex-form" onSubmit={handleSubmit}>
      <select className="engines__reindex-select" aria-label="reindex domain" value={domain} onChange={(event) => handleDomainChange(event.target.value)}>
        {domains.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select className="engines__reindex-select" aria-label="reindex field" value={field} onChange={(event) => setField(event.target.value)}>
        <option value={ALL_INDEXES}>all indexes</option>
        {fields.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <button type="submit" className="engines__reindex-submit" disabled={mutation.isPending}>
        start reindex
      </button>
      <button type="button" className="engines__reindex-cancel" onClick={onClose}>
        cancel
      </button>
      {errorMessage !== undefined && <span className="engines__reindex-error">{errorMessage}</span>}
    </form>
  )
}

/** TASKS & JOBS-Karte (spec engines/001 §4, Trigger-Formular engines/002): client-gestartete Reindex-Tasks + Zählerzeilen aus /metrics.system. */
export function TasksJobsCard({ apiClient, system }: TasksJobsCardProps) {
  const tasks = useReindexTasks()
  const [formOpen, setFormOpen] = useState(false)
  const jsonDomainsQuery = useQuery(jsonDomainsQueryOptions(apiClient))
  const domains = (jsonDomainsQuery.data ?? []).filter((domain) => domain.state !== 'deleting').map((domain) => domain.name)
  const triggerDisabled = domains.length === 0

  return (
    <div className="engines__card engines__tasks">
      <div className="engines__tasks-head">
        <div className="engines__card-title mono-label">TASKS &amp; JOBS</div>
        <button
          type="button"
          className="engines__reindex-toggle"
          disabled={triggerDisabled}
          title={triggerDisabled ? 'no JSON domains to reindex' : undefined}
          onClick={() => setFormOpen((open) => !open)}
        >
          ▶ reindex…
        </button>
      </div>
      {formOpen && apiClient !== undefined && <ReindexTriggerForm apiClient={apiClient} domains={domains} onClose={() => setFormOpen(false)} />}
      {tasks.map((task) => (
        <ReindexTaskPoller key={task.taskId} apiClient={apiClient} task={task} />
      ))}
      {tasks.length === 0 ? (
        <div className="engines__empty">no client-started tasks</div>
      ) : (
        tasks.map((task) => <ReindexTaskRow key={task.taskId} task={task} />)
      )}
      <div className="engines__task-row">
        <span className="engines__dot" />
        <span className="engines__task-label">compaction runs</span>
        <span className="engines__task-meta">{formatNumber(system?.compactionRuns ?? 0)}</span>
      </div>
      <div className="engines__task-row">
        <span className="engines__dot" />
        <span className="engines__task-label">janitor runs</span>
        <span className="engines__task-meta">{formatNumber(system?.janitorRuns ?? 0)}</span>
      </div>
    </div>
  )
}
