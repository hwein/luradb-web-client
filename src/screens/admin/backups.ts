import { queryOptions, type QueryFunctionContext } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { ApiError, apiErrorFromResponse, BASE_PATH, messageFromBody, type ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { pollSilentRecord } from '../../shell/pollSilentRecord'

export type BackupSummary = components['schemas']['BackupSummaryResponse']
export type BackupDetail = components['schemas']['BackupDetailResponse']
export type RunningBackupInfo = components['schemas']['RunningBackupInfo']
export type RestoreStatus = components['schemas']['RestoreStatusResponse']
export type RestoreRequest = components['schemas']['RestoreRequest']

/** 503 = Feature aus, 404 = Route fehlt (Server < 0.3.0) — beides sind Anzeigezustände, keine Fehler (spec §9). */
export type BackupsResult =
  | { kind: 'ok'; backups: BackupSummary[]; running: RunningBackupInfo | null }
  | { kind: 'disabled' }
  | { kind: 'unsupported' }

export type BackupDetailResult = { kind: 'ok'; detail: BackupDetail } | { kind: 'missing' }

/** 404 = Status-RAM weg (Server-Neustart), sonst der Live-Status. */
export type RestoreStatusResult = { kind: 'status'; status: RestoreStatus } | { kind: 'lost' }

export const BACKUPS_KEY = ['backups', 'list'] as const

/** openapi-fetch liest den Fehler-Body selbst: Plaintext ⇒ String, JSON ⇒ Objekt (Body danach verbraucht). */
function errorText(error: unknown): string | undefined {
  if (typeof error === 'string') return error.trim() === '' ? undefined : error.trim()
  return messageFromBody(error)
}

function apiError(status: number, error: unknown, fallback: string): ApiError {
  return new ApiError(status, errorText(error) ?? fallback)
}

export function backupsQueryOptions(apiClient: ApiClient | undefined, restoreRunning: boolean) {
  // Deckt sich mit der refetchInterval-Bedingung unten: still nur, wenn schon VOR diesem Fetch ein Job lief —
  // Erst-Load und ein im Leerlauf durch Mutation/Fokus ausgelöster Refetch bleiben sichtbar
  // (general/012 §3: "nur die Intervall-Ticks").
  function wasPolling(context: Pick<QueryFunctionContext, 'client' | 'queryKey'>): boolean {
    const data = context.client.getQueryState<BackupsResult>(context.queryKey)?.data
    return (data?.kind === 'ok' && data.running !== null) || restoreRunning
  }

  return queryOptions({
    queryKey: BACKUPS_KEY,
    queryFn: async (context): Promise<BackupsResult> => {
      if (!apiClient) throw new Error('backup list query requires an active connection')
      const { data, error, response } = await apiClient.api.GET('/store-api/backups', { silentRecord: wasPolling(context) })
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (response.status === 503) return { kind: 'disabled' }
      if (response.status === 404) return { kind: 'unsupported' }
      if (!response.ok || !data) throw apiError(response.status, error, 'backup list failed')
      return { kind: 'ok', backups: data.backups, running: data.running ?? null }
    },
    enabled: apiClient !== undefined,
    // Poll nur solange ein Job läuft (spec §3) — der letzte Tick liefert den Endstand selbst.
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.kind === 'ok' && data.running !== null) return 2000
      return restoreRunning ? 2000 : false
    },
  })
}

export function backupDetailQueryOptions(apiClient: ApiClient | undefined, id: string) {
  return queryOptions({
    queryKey: ['backups', 'detail', id] as const,
    queryFn: async (): Promise<BackupDetailResult> => {
      if (!apiClient) throw new Error('backup detail query requires an active connection')
      const { data, error, response } = await apiClient.api.GET('/store-api/backups/{id}', { params: { path: { id } } })
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (response.status === 404) return { kind: 'missing' }
      if (!response.ok || !data) throw apiError(response.status, error, 'backup detail failed')
      return { kind: 'ok', detail: data }
    },
    enabled: apiClient !== undefined,
  })
}

export function restoreStatusQueryOptions(apiClient: ApiClient | undefined, restoreId: string | undefined) {
  return queryOptions({
    queryKey: ['restores', restoreId ?? ''] as const,
    queryFn: async (context): Promise<RestoreStatusResult> => {
      if (!apiClient || restoreId === undefined) throw new Error('restore status query requires an active connection')
      const { data, error, response } = await apiClient.api.GET('/store-api/restores/{id}', {
        params: { path: { id: restoreId } },
        silentRecord: pollSilentRecord(context),
      })
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (response.status === 404) return { kind: 'lost' }
      if (!response.ok || !data) throw apiError(response.status, error, 'restore status failed')
      return { kind: 'status', status: data }
    },
    enabled: apiClient !== undefined && restoreId !== undefined,
    // Ohne Ergebnis (auch nach transientem 5xx/Netzfehler) weiter versuchen; Endzustände und
    // 503 (Feature abgeschaltet — heilt nur durch den Operator, Fokus-Refetch reicht) beenden den Poll.
    refetchInterval: (query) => {
      const error = query.state.error
      if (error instanceof ApiError && error.status === 503) return false
      const data = query.state.data
      if (data === undefined) return 2000
      return data.kind === 'status' && data.status.state === 'running' ? 2000 : false
    },
  })
}

export async function createBackup(apiClient: ApiClient, scope: string, includeAuth: boolean): Promise<void> {
  const { error, response } = await apiClient.api.POST('/store-api/backups', {
    body: includeAuth ? { scope, include_auth: true } : { scope },
  })
  if (!response.ok) throw apiError(response.status, error, 'backup start failed')
}

export async function deleteBackup(apiClient: ApiClient, id: string): Promise<void> {
  const { error, response } = await apiClient.api.DELETE('/store-api/backups/{id}', { params: { path: { id } } })
  if (!response.ok) throw apiError(response.status, error, 'delete failed')
}

export async function startRestore(apiClient: ApiClient, id: string, body: RestoreRequest): Promise<string> {
  const { data, error, response } = await apiClient.api.POST('/store-api/backups/{id}/restore', { params: { path: { id } }, body })
  if (!response.ok || !data) throw apiError(response.status, error, 'restore start failed')
  return data.restore_id
}

/** Roh-Body-Upload (Contract: text/plain); `postNdjson` wirft nicht — Nicht-2xx wird hier übersetzt (spec §8). */
export async function uploadBackup(apiClient: ApiClient, ndjson: string): Promise<void> {
  const response = await apiClient.postNdjson(`${BASE_PATH}/backups/upload`, ndjson)
  if (!response.ok) throw await apiErrorFromResponse(response)
}

/** Blob+Anchor-Muster wie der JSON-Export (data/005) — die Datei läuft bewusst durch den RAM. */
export async function downloadBackup(apiClient: ApiClient, id: string): Promise<void> {
  const response = await apiClient.fetchNdjson(`${BASE_PATH}/backups/${encodeURIComponent(id)}/download`)
  const blob = new Blob([await response.text()], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${id}.ndjson`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

// --- Restore-Registry: nur Identität, kein Status-Spiegeln (spec §6, Muster src/lib/tasks.ts) ---------

export interface RestoreEntry {
  restore_id: string
  backup_id: string
  startedAt: number
  include_auth: boolean
  /** Verbindung, auf der der Restore gestartet wurde — Einträge fremder Verbindungen werden ignoriert (restore_ids sind server-lokal). */
  connectionId: string
}

const RESTORE_STORAGE_KEY = 'luradb.restore'

function readStored(): RestoreEntry | undefined {
  try {
    const raw = sessionStorage.getItem(RESTORE_STORAGE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const entry = parsed as RestoreEntry
    return typeof entry.restore_id === 'string' && typeof entry.backup_id === 'string' && typeof entry.connectionId === 'string'
      ? entry
      : undefined
  } catch {
    return undefined
  }
}

let entry: RestoreEntry | undefined = readStored()
const listeners = new Set<() => void>()

function setEntry(next: RestoreEntry | undefined): void {
  entry = next
  if (next === undefined) sessionStorage.removeItem(RESTORE_STORAGE_KEY)
  else sessionStorage.setItem(RESTORE_STORAGE_KEY, JSON.stringify(next))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): RestoreEntry | undefined {
  return entry
}

/** Der zuletzt gestartete Restore — überlebt Modal-Close und Reload, bleibt bis zum Dismiss. */
export function useRestoreEntry(): RestoreEntry | undefined {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function noteRestoreStarted(next: RestoreEntry): void {
  setEntry(next)
}

export function clearRestoreEntry(): void {
  setEntry(undefined)
}

// --- Formatierung ------------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `today HH:MM` / `yesterday HH:MM` (Grenze lokale Mitternacht), sonst `YYYY-MM-DD HH:MM` (spec §2). */
export function formatBackupTime(unixSeconds: number, now: Date = new Date()): string {
  const date = new Date(unixSeconds * 1000)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  if (date.getTime() >= startOfToday) return `today ${time}`
  if (date.getTime() >= startOfYesterday) return `yesterday ${time}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

/** Verstrichene Zeit eines laufenden Jobs: `<n>s` unter 60 s, sonst `M:SS` (spec §3). */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}
