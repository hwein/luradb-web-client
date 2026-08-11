import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import { openDocs } from '../docs/openDocs'
import {
  filterByContains,
  kvBulkCallPattern,
  kvBulkConfirmText,
  runKvBulk,
  runKvBulkOp,
  KV_BULK_CONCURRENCY,
  type KvBulkAction,
  type KvBulkRunResult,
} from './kvBulk'
import { invalidateKvKeys } from './kvEntries'

const ACTIONS: KvBulkAction[] = ['delete', 'clear', 'set-null']

/** Nur die Vorschau ist gekappt (Tipp-Lag bei 10k+-Scans) — Selektion und Lauf nutzen die volle Liste; ungekappt bleibt laut Spec §5 allein die Fehlerliste. */
const PREVIEW_LIMIT = 200

const ACTION_LABEL: Record<KvBulkAction, string> = {
  delete: 'delete',
  clear: 'set value to ""',
  'set-null': 'set null',
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

interface KvBulkBarProps {
  domain: string
  apiClient: ApiClient | undefined
  keys: string[]
  prefix: string
}

/**
 * Bulk-Leiste (spec data/008): Panel unter dem Header, Karten-Vokabular. Grundlage ist immer das
 * committete Scan-Ergebnis (`keys`-Prop aus `kvKeysQueryOptions`) — kein eigener Scan-Pfad.
 */
export function KvBulkBar({ domain, apiClient, keys, prefix }: KvBulkBarProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [contains, setContains] = useState('')
  const [action, setAction] = useState<KvBulkAction | undefined>(undefined)
  const [confirmArmed, setConfirmArmed] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined)

  const selectedKeys = filterByContains(keys, contains)

  const runMutation = useMutation<KvBulkRunResult, unknown, { keys: string[]; action: KvBulkAction }>({
    mutationFn: async ({ keys: opKeys, action: opAction }) => {
      if (!apiClient) throw new Error('no active connection')
      setProgress({ done: 0, total: opKeys.length })
      return runKvBulk(
        opKeys,
        KV_BULK_CONCURRENCY,
        (key) => runKvBulkOp(apiClient, domain, opAction, key),
        (done, total) => setProgress({ done, total }),
      )
    },
    onSuccess: () => {
      invalidateKvKeys(queryClient, domain)
    },
  })

  function changeContains(value: string): void {
    setContains(value)
    setConfirmArmed(false)
  }

  function changeAction(next: KvBulkAction): void {
    setAction(next)
    setConfirmArmed(false)
  }

  function handleRunClick(): void {
    if (!confirmArmed) {
      setConfirmArmed(true)
      return
    }
    if (action === undefined) return
    setConfirmArmed(false)
    runMutation.mutate({ keys: selectedKeys, action })
  }

  function openNullDocs(): void {
    openDocs('kv-engine')
    void navigate('/docs')
  }

  const runDisabled = action === undefined || selectedKeys.length === 0 || apiClient === undefined || runMutation.isPending

  return (
    <div className="kv-bulk">
      <div className="kv-bulk__row">
        <span className="kv-bulk__scope mono-path">
          {keys.length} keys scanned (prefix "{prefix}")
        </span>
        <input
          className="kv-bulk__contains-input"
          value={contains}
          onChange={(event) => changeContains(event.target.value)}
          placeholder="contains…"
          aria-label="bulk key filter"
          spellCheck={false}
          disabled={runMutation.isPending}
        />
        <span className="kv-bulk__count mono-path">{selectedKeys.length} keys selected</span>
      </div>

      <div className="kv-bulk__preview">
        {selectedKeys.length === 0 ? (
          <div className="kv-bulk__hint">no keys selected</div>
        ) : (
          <>
            {selectedKeys.slice(0, PREVIEW_LIMIT).map((key) => (
              <div key={key} className="kv-bulk__preview-row">
                {key}
              </div>
            ))}
            {selectedKeys.length > PREVIEW_LIMIT && (
              <div className="kv-bulk__hint">… and {selectedKeys.length - PREVIEW_LIMIT} more keys</div>
            )}
          </>
        )}
      </div>

      <div className="kv-bulk__actions">
        {ACTIONS.map((option) => (
          <label key={option} className="kv-bulk__action">
            <input
              type="radio"
              name="kv-bulk-action"
              value={option}
              checked={action === option}
              onChange={() => changeAction(option)}
              disabled={runMutation.isPending}
            />
            {ACTION_LABEL[option]}
          </label>
        ))}
        {confirmArmed ? (
          <span className="kv-bulk__confirm">
            <span className="kv-bulk__confirm-text">
              {action !== undefined && kvBulkConfirmText(action, selectedKeys.length, domain)}
              {(action === 'delete' || action === 'set-null') && <span className="kv-bulk__confirm-irreversible"> this cannot be undone.</span>}
            </span>
            <button type="button" className="kv-bulk__confirm-run" disabled={runMutation.isPending} onClick={handleRunClick}>
              run
            </button>
            <button type="button" className="kv-bulk__confirm-cancel" disabled={runMutation.isPending} onClick={() => setConfirmArmed(false)}>
              cancel
            </button>
          </span>
        ) : (
          <button type="button" className="kv-bulk__run" disabled={runDisabled} onClick={handleRunClick}>
            run…
          </button>
        )}
      </div>

      {action === 'set-null' && (
        <div className="kv-bulk__null-hint">
          server stores null as a tombstone — reads answer 404 (like delete){' '}
          <button type="button" className="kv-bulk__null-docs" onClick={openNullDocs}>
            docs
          </button>
        </div>
      )}

      {action !== undefined && (
        <div className="kv-bulk__call-pattern mono-path">
          {selectedKeys.length} × {kvBulkCallPattern(action, domain)} · not recorded
        </div>
      )}

      {runMutation.isPending && progress !== undefined && (
        <div className="kv-bulk__progress mono-path">
          {progress.done}/{progress.total}
        </div>
      )}

      {runMutation.isError && <div className="kv-bulk__error">{messageOf(runMutation.error)}</div>}

      {runMutation.data !== undefined && (
        <div className="kv-bulk__result">
          <div className="kv-bulk__summary">
            ok {runMutation.data.okCount} ·{' '}
            <span className={runMutation.data.failures.length > 0 ? 'kv-bulk__summary-failed' : undefined}>
              failed {runMutation.data.failures.length}
            </span>
          </div>
          {runMutation.data.failures.length > 0 && (
            <ul className="kv-bulk__error-list">
              {runMutation.data.failures.map((failure, index) => (
                <li key={`${failure.key}-${index}`} className="kv-bulk__error-entry">
                  {failure.key} · {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
