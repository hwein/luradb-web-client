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

/** Client-gestartete Reindex-Tasks (spec engines/001 §4) — Session-Lebensdauer via sessionStorage, älteste zuerst. */
export function useReindexTasks(): ReindexTask[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Matcht auf erfolgreiche `POST /store-api/json/{domain}/reindex`-Sends aus dem REST Explorer
 * (spec engines/001 Orchestrator-Hinweis 1): parst die Domäne aus dem Pfad und registriert den Task.
 * Kein Treffer (anderer Pfad, oder Response ohne `task_id`) ⇒ no-op.
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

/** Übernimmt ein Poll-Ergebnis in die Registry; no-op bei unbekannter Id oder unverändertem Status (verhindert Render-Schleifen). */
export function updateReindexTaskStatus(taskId: string, status: ReindexTaskStatus): void {
  const index = tasks.findIndex((task) => task.taskId === taskId)
  const current = tasks[index]
  if (current === undefined || statusEquals(current.status, status)) return
  const next = [...tasks]
  next[index] = { ...current, status }
  setTasks(next)
}

/** Nur für Tests. */
export function resetReindexTasks(): void {
  setTasks([])
}
