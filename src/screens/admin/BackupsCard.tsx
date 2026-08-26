import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ApiError, type ApiClient } from '../../api'
import { useSession } from '../../app/session'
import { formatBytes } from '../../lib'
import { jsonDomainsQueryOptions, kvDomainsQueryOptions } from '../../shell/domains'
import {
  BACKUPS_KEY,
  backupsQueryOptions,
  clearRestoreEntry,
  createBackup,
  deleteBackup,
  downloadBackup,
  formatBackupTime,
  formatElapsed,
  restoreStatusQueryOptions,
  uploadBackup,
  useRestoreEntry,
  type BackupSummary,
  type RestoreEntry,
  type RestoreStatusResult,
  type RunningBackupInfo,
} from './backups'
import { invalidateDomainLists } from './DomainsCard'
import { RestoreModal } from './RestoreModal'
import { USERS_KEY } from './users'

type ScopeKind = 'all' | 'kv' | 'json' | 'domain'

const ENTIRE_ENGINE = ''
const POLL_MS = 2000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('backup action requires an active connection')
  return apiClient
}

function statusOf(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined
}

/** Ein Tick im Poll-Takt, damit die verstrichene Zeit eines laufenden Jobs mitläuft. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), POLL_MS)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function RunningBackupRow({ running }: { running: RunningBackupInfo }) {
  const now = useTick(true)
  return (
    <div className="admin-backups__row">
      <span className="admin-backups__dot admin-backups__dot--running" />
      <span className="admin-backups__label">{running.scope} · running</span>
      <span className="admin-backups__size">{formatElapsed(now / 1000 - running.started_at)}</span>
    </div>
  )
}

interface RestoreRowProps {
  entry: RestoreEntry
  result: RestoreStatusResult | undefined
  onView: () => void
}

/** Der laufende/zuletzt gelaufene Restore ist server-seitig nicht auflistbar — die Karte hält ihn (spec §3b/§6). */
function RestoreRow({ entry, result, onView }: RestoreRowProps) {
  const queryClient = useQueryClient()
  const label = result === undefined ? 'running' : result.kind === 'lost' ? 'status lost' : result.status.state
  const terminal = label === 'complete' || label === 'failed' || label === 'status lost'

  const invalidatedRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!terminal || invalidatedRef.current === entry.restore_id) return
    invalidatedRef.current = entry.restore_id
    invalidateDomainLists(queryClient)
    if (entry.include_auth) {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['capabilities', 'admin-probe'] })
    }
  }, [terminal, entry.restore_id, entry.include_auth, queryClient])

  return (
    <div className="admin-backups__row">
      <span className={`admin-backups__dot admin-backups__dot--${label === 'failed' || label === 'status lost' ? 'err' : 'running'}`} />
      <span className="admin-backups__label">restore · {label}</span>
      <span className="admin-backups__actions">
        <button type="button" className="admin-backups__action" onClick={onView}>
          view
        </button>
        {terminal && (
          <button type="button" className="admin-backups__dismiss" title="dismiss" onClick={() => clearRestoreEntry()}>
            ×
          </button>
        )}
      </span>
    </div>
  )
}

const DOT_CLASS: Record<string, string> = { complete: 'ok', incomplete: 'err' }
const DOT_TITLE: Record<string, string> = { incomplete: 'checksum missing — incomplete' }

interface BackupRowProps {
  apiClient: ApiClient | undefined
  backup: BackupSummary
  jobBusy: boolean
  onRestore: () => void
}

function BackupRow({ apiClient, backup, jobBusy, onRestore }: BackupRowProps) {
  const queryClient = useQueryClient()
  const [armed, setArmed] = useState(false)
  const incomplete = backup.state === 'incomplete'

  function handleError(error: unknown): void {
    if (statusOf(error) === 404) void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY })
  }

  const downloadMutation = useMutation<void, unknown, void>({
    mutationFn: () => downloadBackup(requireApiClient(apiClient), backup.id),
    onError: handleError,
  })

  const deleteMutation = useMutation<void, unknown, void>({
    mutationFn: () => deleteBackup(requireApiClient(apiClient), backup.id),
    onSuccess: () => {
      setArmed(false)
      void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY })
    },
    onError: handleError,
  })

  const error = downloadMutation.isError ? downloadMutation.error : deleteMutation.isError ? deleteMutation.error : undefined

  return (
    <div className="admin-backups__item">
      <div className="admin-backups__row">
        <span className={`admin-backups__dot admin-backups__dot--${DOT_CLASS[backup.state] ?? 'muted'}`} title={DOT_TITLE[backup.state]} />
        <span className="admin-backups__label">
          {backup.scope} · {formatBackupTime(backup.created_at)}
          {backup.schedule !== null && backup.schedule !== undefined && <span className="admin-backups__schedule"> · {backup.schedule}</span>}
        </span>
        <span className="admin-backups__size">{formatBytes(backup.size_bytes)}</span>
        <span className="admin-backups__actions">
          <button
            type="button"
            className="admin-backups__action"
            title="download"
            disabled={downloadMutation.isPending}
            onClick={() => downloadMutation.mutate()}
          >
            {downloadMutation.isPending ? 'downloading…' : '↓'}
          </button>
          <button
            type="button"
            className="admin-backups__action"
            disabled={jobBusy || incomplete}
            title={incomplete ? 'incomplete archive — cannot restore' : undefined}
            onClick={onRestore}
          >
            restore
          </button>
          <button type="button" className="admin-backups__trash" title="delete backup" onClick={() => setArmed(true)}>
            🗑
          </button>
        </span>
      </div>
      {armed && (
        <div className="admin-backups__confirm">
          delete &quot;{backup.id}&quot;?{' '}
          <button
            type="button"
            className="admin-backups__confirm-action"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            confirm
          </button>{' '}
          ·{' '}
          <button type="button" className="admin-backups__confirm-cancel" onClick={() => setArmed(false)}>
            cancel
          </button>
        </div>
      )}
      {error !== undefined && <div className="admin-backups__error">{messageOf(error)}</div>}
    </div>
  )
}

interface RunFormProps {
  apiClient: ApiClient | undefined
  onDone: () => void
}

/** Inline-Formular hinter "▶ run backup now" (spec §5): Scope-Segmente, optionale/pflichtige Domänenwahl, include_auth-Gating. */
function RunForm({ apiClient, onDone }: RunFormProps) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ScopeKind>('all')
  const [domain, setDomain] = useState(ENTIRE_ENGINE)
  const [includeAuth, setIncludeAuth] = useState(false)
  const kvDomains = useQuery(kvDomainsQueryOptions(apiClient)).data ?? []
  const jsonDomains = useQuery(jsonDomainsQueryOptions(apiClient)).data ?? []

  const engineDomains = (kind === 'json' ? jsonDomains : kvDomains).map((entry) => entry.name)
  const allDomains = [...new Set([...kvDomains.map((entry) => entry.name), ...jsonDomains.map((entry) => entry.name)])].sort()
  const scope = kind === 'all' ? 'all' : domain === ENTIRE_ENGINE ? kind : `${kind}:${domain}`
  const authAllowed = scope === 'all' || scope === 'kv'
  const effectiveAuth = includeAuth && authAllowed

  const mutation = useMutation<void, unknown, void>({
    mutationFn: () => createBackup(requireApiClient(apiClient), scope, effectiveAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY })
      onDone()
    },
    onError: (error) => {
      if (statusOf(error) === 404) invalidateDomainLists(queryClient)
    },
  })

  function selectKind(next: ScopeKind): void {
    setKind(next)
    setDomain(ENTIRE_ENGINE)
  }

  return (
    <div className="admin-backups__run-form">
      <div className="admin-backups__segments" role="group" aria-label="backup scope">
        {(['all', 'kv', 'json', 'domain'] as ScopeKind[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`admin-backups__segment${kind === option ? ' admin-backups__segment--active' : ''}`}
            onClick={() => selectKind(option)}
          >
            {option}
          </button>
        ))}
        {kind !== 'all' && (
          <select
            className="admin-backups__select"
            aria-label="backup domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          >
            {kind !== 'domain' && <option value={ENTIRE_ENGINE}>entire engine</option>}
            {kind === 'domain' && <option value={ENTIRE_ENGINE}>select a domain</option>}
            {(kind === 'domain' ? allDomains : engineDomains).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="admin-backups__run-actions">
        <label className="admin-backups__check">
          <input type="checkbox" checked={effectiveAuth} disabled={!authAllowed} onChange={(event) => setIncludeAuth(event.target.checked)} />
          include auth records
        </label>
        <span className="admin-backups__spacer" />
        <button type="button" className="admin-backups__cancel" onClick={onDone}>
          cancel
        </button>
        <button
          type="button"
          className="admin-backups__start"
          disabled={mutation.isPending || (kind === 'domain' && domain === ENTIRE_ENGINE)}
          onClick={() => mutation.mutate()}
        >
          start
        </button>
      </div>
      {mutation.isError && <div className="admin-backups__error">{messageOf(mutation.error)}</div>}
    </div>
  )
}

function UploadAction({ apiClient }: { apiClient: ApiClient | undefined }) {
  const queryClient = useQueryClient()
  const mutation = useMutation<void, unknown, string>({
    mutationFn: (ndjson) => uploadBackup(requireApiClient(apiClient), ndjson),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY })
    },
  })

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') mutation.mutate(reader.result)
    }
    reader.readAsText(file)
  }

  return (
    <>
      <label className="admin-backups__upload">
        {mutation.isPending ? 'uploading…' : 'upload archive'}
        <input className="admin-backups__file-input" type="file" accept=".ndjson" aria-label="upload archive" onChange={handleFile} />
      </label>
      {mutation.isError && <div className="admin-backups__error">{messageOf(mutation.error)}</div>}
    </>
  )
}

/** BACKUPS-Karte (spec admin/003, Prototyp Z. 225–231): Liste, laufende Jobs, Run/Upload, Restore-Einstieg. */
export function BackupsCard({ apiClient }: { apiClient: ApiClient | undefined }) {
  const session = useSession()
  const serverVersion = session.status === 'connected' ? session.serverVersion : 'unknown'
  const entry = useRestoreEntry()
  const restoreStatus = useQuery(restoreStatusQueryOptions(apiClient, entry?.restore_id))
  const restoreResult = entry === undefined ? undefined : restoreStatus.data
  const restoreRunning = entry !== undefined && (restoreResult === undefined || (restoreResult.kind === 'status' && restoreResult.status.state === 'running'))
  const listQuery = useQuery(backupsQueryOptions(apiClient, restoreRunning))
  const [runOpen, setRunOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | undefined>(undefined)

  const list = listQuery.data
  const running = list?.kind === 'ok' ? list.running : null
  const backups = list?.kind === 'ok' ? [...list.backups].sort((a, b) => b.created_at - a.created_at) : []
  const jobBusy = running !== null || restoreRunning

  const notice =
    list?.kind === 'disabled'
      ? 'backups disabled — set backup.enabled = true in luradb.toml'
      : list?.kind === 'unsupported'
        ? `requires LuraDB ≥ 0.3.0 (server is ${serverVersion})`
        : undefined

  return (
    <div className="admin-card admin-backups">
      <div className="admin-card__head">BACKUPS</div>
      {notice !== undefined ? (
        <div className="admin-backups__notice">{notice}</div>
      ) : (
        <>
          {running !== null && <RunningBackupRow running={running} />}
          {entry !== undefined && <RestoreRow entry={entry} result={restoreResult} onView={() => setRestoreTarget(entry.backup_id)} />}
          {list?.kind === 'ok' && backups.length === 0 && <div className="admin-backups__empty">no backups yet</div>}
          {backups.map((backup) => (
            <BackupRow key={backup.id} apiClient={apiClient} backup={backup} jobBusy={jobBusy} onRestore={() => setRestoreTarget(backup.id)} />
          ))}
          {runOpen ? (
            <RunForm apiClient={apiClient} onDone={() => setRunOpen(false)} />
          ) : (
            <div className="admin-backups__foot">
              <button type="button" className="admin-backups__run" disabled={jobBusy} onClick={() => setRunOpen(true)}>
                ▶ run backup now
              </button>
              <UploadAction apiClient={apiClient} />
            </div>
          )}
        </>
      )}
      {restoreTarget !== undefined && (
        <RestoreModal apiClient={apiClient} backupId={restoreTarget} onClose={() => setRestoreTarget(undefined)} />
      )}
    </div>
  )
}
