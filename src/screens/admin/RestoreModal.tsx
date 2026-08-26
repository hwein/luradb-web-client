import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '../../api'
import { useSession } from '../../app/session'
import { formatBytes } from '../../lib'
import {
  backupDetailQueryOptions,
  BACKUPS_KEY,
  formatBackupTime,
  noteRestoreStarted,
  restoreStatusQueryOptions,
  startRestore,
  useRestoreEntry,
  type BackupDetail,
  type RestoreRequest,
} from './backups'
import { NAME_PATTERN } from './DomainsCard'
import './RestoreModal.css'

const SINGLE_DOMAIN_SCOPE = /^(kv|json|domain):.+$/

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

function optional(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

function Facts({ detail }: { detail: BackupDetail }) {
  const rows: [string, string][] = [
    ['scope', detail.scope],
    ['created', detail.created_at === null || detail.created_at === undefined ? '—' : formatBackupTime(detail.created_at)],
    ['size', detail.size_bytes === null || detail.size_bytes === undefined ? '—' : formatBytes(detail.size_bytes)],
    ['format version', optional(detail.format_version)],
    ['include auth', optional(detail.include_auth)],
    ['schedule', optional(detail.schedule)],
  ]
  return (
    <dl className="rsm__facts">
      {rows.map(([label, value]) => (
        <div key={label} className="rsm__fact">
          <dt className="rsm__fact-label">{label}</dt>
          <dd className="rsm__fact-value">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Sicht auf `GET /restores/{id}` — der Status lebt nur im Query-Cache, die Registry hält bloß die Identität (spec §6). */
function RestoreStatusView({ apiClient, restoreId }: { apiClient: ApiClient | undefined; restoreId: string }) {
  const statusQuery = useQuery(restoreStatusQueryOptions(apiClient, restoreId))
  const result = statusQuery.data

  if (result === undefined && statusQuery.isError) {
    return <div className="rsm__status rsm__status--lost">restore status unavailable — {messageOf(statusQuery.error)}</div>
  }
  if (result === undefined) return <div className="rsm__status">restore · running</div>
  if (result.kind === 'lost') {
    return <div className="rsm__status rsm__status--lost">restore status lost (server restarted) — check the domain list</div>
  }

  const { state, imported, skipped, failed, errors } = result.status
  return (
    <div className="rsm__status">
      <div className={state === 'failed' ? 'rsm__status-state rsm__status-state--failed' : 'rsm__status-state'}>restore · {state}</div>
      {state !== 'running' && (
        <div className="rsm__status-counts">
          imported {imported} · skipped {skipped} · <span className={failed > 0 ? 'rsm__status-failed' : undefined}>failed {failed}</span>
        </div>
      )}
      {errors.length > 0 && (
        <ul className="rsm__error-list">
          {errors.map((entry, index) => (
            <li key={`${entry.key}-${index}`} className="rsm__error-entry">
              {entry.key} · {entry.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface RestoreFormProps {
  apiClient: ApiClient | undefined
  backupId: string
  onClose: () => void
}

/** Optionen + Status eines Restores (spec §7) — ohne `<dialog>`-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
export function RestoreForm({ apiClient, backupId, onClose }: RestoreFormProps) {
  const queryClient = useQueryClient()
  const session = useSession()
  const connectionId = session.status === 'connected' ? session.connection.id : undefined
  const storedEntry = useRestoreEntry()
  const entry = storedEntry !== undefined && storedEntry.connectionId === connectionId ? storedEntry : undefined
  const detailQuery = useQuery(backupDetailQueryOptions(apiClient, backupId))
  const [mode, setMode] = useState<'fail_if_exists' | 'replace'>('fail_if_exists')
  const [intoDomain, setIntoDomain] = useState('')
  const [applyAuth, setApplyAuth] = useState(false)
  const [armed, setArmed] = useState(false)

  const detail = detailQuery.data?.kind === 'ok' ? detailQuery.data.detail : undefined
  const missing = detailQuery.data?.kind === 'missing'

  const invalidatedRef = useRef(false)
  useEffect(() => {
    if (!missing || invalidatedRef.current) return
    invalidatedRef.current = true
    void queryClient.invalidateQueries({ queryKey: BACKUPS_KEY })
  }, [missing, queryClient])

  const mutation = useMutation<string, unknown, void>({
    mutationFn: () => {
      if (!apiClient) throw new Error('restore requires an active connection')
      const body: RestoreRequest = { mode }
      if (intoDomain !== '') body.into_domain = intoDomain
      if (applyAuth) body.include_auth = true
      return startRestore(apiClient, backupId, body)
    },
    onSuccess: (restoreId) => {
      noteRestoreStarted({
        restore_id: restoreId,
        backup_id: backupId,
        startedAt: Date.now(),
        include_auth: applyAuth,
        connectionId: connectionId ?? '',
      })
    },
  })

  const scope = detail?.scope ?? ''
  const singleDomain = SINGLE_DOMAIN_SCOPE.test(scope)
  // Auch die JSON-Engine legt eine default-Domäne automatisch an (live verifiziert) — der Hinweis gilt für alle Ganz-Engine-Scopes.
  const wholeEngine = scope === 'all' || scope === 'kv' || scope === 'json'
  const intoDomainValid = intoDomain === '' || (intoDomain.length <= 50 && NAME_PATTERN.test(intoDomain))
  const activeRestoreId = entry !== undefined && entry.backup_id === backupId ? entry.restore_id : undefined

  function handleSubmit(): void {
    if (mode === 'replace' && !armed) {
      setArmed(true)
      return
    }
    mutation.mutate()
  }

  return (
    <>
      <div className="rsm__head">
        <span id="rsm-title" className="rsm__title mono-label">
          restore · {backupId}
        </span>
      </div>
      <div className="rsm__body">
        {missing && <div className="rsm__danger">backup archive is gone — it was deleted on the server</div>}
        {detail && <Facts detail={detail} />}
        {activeRestoreId !== undefined && <RestoreStatusView apiClient={apiClient} restoreId={activeRestoreId} />}
        {activeRestoreId === undefined && detail && (
          <div className="rsm__options">
            <div className="rsm__field">
              <span className="rsm__label">mode</span>
              <div className="rsm__radios">
                <label className="rsm__radio">
                  <input
                    type="radio"
                    name="rsm-mode"
                    checked={mode === 'fail_if_exists'}
                    onChange={() => {
                      setMode('fail_if_exists')
                      setArmed(false)
                    }}
                  />
                  fail_if_exists
                </label>
                <label className="rsm__radio">
                  <input type="radio" name="rsm-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  replace
                </label>
              </div>
            </div>
            {mode === 'replace' && <div className="rsm__danger">replace deletes existing target domains</div>}
            {wholeEngine && mode === 'fail_if_exists' && (
              <div className="rsm__hint">whole-engine restores usually need replace — the auto-created &quot;default&quot; domain already exists</div>
            )}
            {singleDomain && (
              <div className="rsm__field">
                <label className="rsm__label" htmlFor="rsm-into-domain">
                  into domain
                </label>
                <input
                  id="rsm-into-domain"
                  className="rsm__input"
                  value={intoDomain}
                  onChange={(event) => setIntoDomain(event.target.value)}
                  placeholder="leave empty to keep the archived name"
                  maxLength={50}
                />
                {!intoDomainValid && <div className="rsm__danger">max 50 chars, [a-zA-Z0-9_-]</div>}
              </div>
            )}
            <label className="rsm__check">
              <input
                type="checkbox"
                checked={applyAuth}
                disabled={detail.include_auth === false}
                onChange={(event) => setApplyAuth(event.target.checked)}
              />
              apply auth records
            </label>
            {applyAuth && <div className="rsm__hint">may replace users and keys — your own key can change (reconnect required)</div>}
            {mutation.isError && <div className="rsm__danger">{messageOf(mutation.error)}</div>}
          </div>
        )}
      </div>
      <div className="rsm__footer">
        <button type="button" className="rsm__close" onClick={onClose}>
          close
        </button>
        {activeRestoreId === undefined && detail && (
          <button type="button" className="rsm__submit" onClick={handleSubmit} disabled={mutation.isPending || !intoDomainValid}>
            {armed && mode === 'replace' ? 'confirm replace' : 'restore'}
          </button>
        )}
      </div>
    </>
  )
}

/** Natives `<dialog>` + `showModal()` um `RestoreForm` (Muster BulkImportModal) — jederzeit schließbar. */
export function RestoreModal({ apiClient, backupId, onClose }: RestoreFormProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (!dialog.open) dialog.showModal()
    function handleClose(): void {
      onCloseRef.current()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog ref={dialogRef} className="rsm" aria-labelledby="rsm-title">
      <RestoreForm apiClient={apiClient} backupId={backupId} onClose={onClose} />
    </dialog>
  )
}
