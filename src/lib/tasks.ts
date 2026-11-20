import { useSyncExternalStore } from 'react'

export type ReindexTaskStatus =
  | { kind: 'running'; processed: number; totalEstimated: number }
  | { kind: 'completed'; processed: number; durationSecs: number }
  | { kind: 'failed'; processed: number; error: string }

export interface ReindexTask {
  taskId: string
  domain: string
  startedAt: number
  status: ReindexTaskStatus
}

const STORAGE_KEY = 'luradb.reindexTasks'
const REINDEX_START_PATH = /^\/store-api\/json\/([^/]+)\/reindex$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStored(): ReindexTask[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ReindexTask[]) : []
  } catch {
    return []
  }
}

let tasks: ReindexTask[] = readStored()
const listeners = new Set<() => void>()

function setTasks(next: ReindexTask[]): void {
  tasks = next
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ReindexTask[] {
  return tasks
}

/** Client-started reindex tasks; session lifetime via sessionStorage, oldest first. */
export function useReindexTasks(): ReindexTask[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Matches successful `POST /store-api/json/{domain}/reindex` sends from the REST Explorer:
 * parses the domain from the path and registers the task.
 * No match (other path, or response without `task_id`) ⇒ no-op.
 */
export function noteReindexStart(path: string, responseBody: unknown): void {
  const match = REINDEX_START_PATH.exec(path)
  const domain = match?.[1]
  if (domain === undefined) return
  if (!isRecord(responseBody) || typeof responseBody.task_id !== 'string') return

  const task: ReindexTask = {
    taskId: responseBody.task_id,
    domain: decodeURIComponent(domain),
    startedAt: Date.now(),
    status: { kind: 'running', processed: 0, totalEstimated: 0 },
  }
  setTasks([...tasks, task])
}

function statusEquals(a: ReindexTaskStatus, b: ReindexTaskStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Takes a poll result into the registry; no-op for an unknown id or unchanged status (prevents render loops). */
export function updateReindexTaskStatus(taskId: string, status: ReindexTaskStatus): void {
  const index = tasks.findIndex((task) => task.taskId === taskId)
  const current = tasks[index]
  if (current === undefined || statusEquals(current.status, status)) return
  const next = [...tasks]
  next[index] = { ...current, status }
  setTasks(next)
}

/** Tests only. */
export function resetReindexTasks(): void {
  setTasks([])
}
