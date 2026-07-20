import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ApiClient } from '../../api'
import { updateReindexTaskStatus, useReindexTasks, type ReindexTask } from '../../lib/tasks'
import { formatNumber } from './format'
import type { SystemMetrics } from './metrics'
import { reindexStatusQueryOptions } from './reindexPoll'

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

/** TASKS & JOBS-Karte (spec engines/001 §4): client-gestartete Reindex-Tasks + Zählerzeilen aus /metrics.system. */
export function TasksJobsCard({ apiClient, system }: TasksJobsCardProps) {
  const tasks = useReindexTasks()

  return (
    <div className="engines__card engines__tasks">
      <div className="engines__card-title mono-label">TASKS &amp; JOBS</div>
      {tasks.map((task) => (
        <ReindexTaskPoller key={task.taskId} apiClient={apiClient} task={task} />
      ))}
      {tasks.length === 0 ? (
        <div className="engines__empty">no client-started tasks · reindex can be triggered via REST explorer</div>
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
