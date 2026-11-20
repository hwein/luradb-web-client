import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import { formatNumber } from '../../lib'
import { useDomainSummaries } from '../../shell/domains'
import { openDocs } from '../docs/openDocs'
import {
  kvBulkCallPattern,
  kvBulkConfirmText,
  kvBulkDeletePath,
  kvBulkServerDeleteConfirmText,
  runKvBulk,
  runKvBulkDelete,
  runKvBulkOp,
  usesServerDelete,
  KV_BULK_CONCURRENCY,
  type KvBulkAction,
  type KvBulkOutcome,
} from './kvBulk'
import { invalidateKvKeys, kvBulkKeysQueryOptions, type KvKeyFilter } from './kvEntries'

const ACTIONS: KvBulkAction[] = ['delete', 'clear', 'set-null']

/** Only the preview is capped (DOM load with 10k selections); selection and run use the whole loaded page; only the error list is uncapped. */
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
  /** The committed header scan: the prefix is fixed, `contains` is the bar filter's start value (the server has only one `contains` parameter). */
  scan: KvKeyFilter
}

interface RunVariables {
  keys: string[]
  action: KvBulkAction
  filter: KvKeyFilter
}

/**
 * Bulk bar: panel below the header. Basis is the committed header scan (prefix + contains); the contains
 * filter can be re-committed here, server-side, one page at the server maximum. KvBrowser remounts the bar
 * per committed scan (`key`), so the initial state suffices.
 * `delete` with a prefix runs as one server call, all other paths as fan-out.
 */
export function KvBulkBar({ domain, apiClient, scan }: KvBulkBarProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [containsText, setContainsText] = useState(scan.contains)
  const [contains, setContains] = useState(scan.contains)
  const [action, setAction] = useState<KvBulkAction | undefined>(undefined)
  const [confirmArmed, setConfirmArmed] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined)

  const filter: KvKeyFilter = { prefix: scan.prefix, contains }
  const keysQuery = useQuery(kvBulkKeysQueryOptions(apiClient, domain, filter))
  const selectedKeys = keysQuery.data?.keys ?? []
  const total = keysQuery.data?.total ?? 0
  const capped = total > selectedKeys.length
  const serverDelete = action !== undefined && usesServerDelete(action, filter)
  const domains = useDomainSummaries(apiClient)
  const conditional = domains.find((summary) => summary.name === domain)?.conditionalWrites.includes('kv') ?? false

  const runMutation = useMutation<KvBulkOutcome, unknown, RunVariables>({
    mutationFn: async (variables) => {
      if (!apiClient) throw new Error('no active connection')
      if (usesServerDelete(variables.action, variables.filter)) {
        return { kind: 'server', deleted: await runKvBulkDelete(apiClient, domain, variables.filter) }
      }
      setProgress({ done: 0, total: variables.keys.length })
      const result = await runKvBulk(
        variables.keys,
        KV_BULK_CONCURRENCY,
        (key) => runKvBulkOp(apiClient, domain, variables.action, key, conditional),
        (done, total) => setProgress({ done, total }),
      )
      return { kind: 'fanout', ...result }
    },
    onSuccess: () => {
      invalidateKvKeys(queryClient, domain)
      // set null/clear change value and metadata of a possibly open detail without the key leaving the list (upsert).
      void queryClient.invalidateQueries({ queryKey: ['kv-value', domain] })
      void queryClient.invalidateQueries({ queryKey: ['kv-meta', domain] })
    },
  })

  function changeContainsText(value: string): void {
    setContainsText(value)
    setConfirmArmed(false)
  }

  function applyContains(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next = containsText.trim()
    setConfirmArmed(false)
    // An unchanged filter would be a state no-op; apply still fetches fresh data (as the header scan does).
    if (next === contains) {
      void queryClient.invalidateQueries({ queryKey: ['kv-keys-bulk', domain] })
      return
    }
    setContains(next)
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
    runMutation.mutate({ keys: selectedKeys, action, filter })
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
          {keysQuery.data !== undefined ? `${formatNumber(selectedKeys.length)} of ${formatNumber(total)} matching keys` : 'loading…'}
          {filter.prefix !== '' && ` · prefix "${filter.prefix}"`}
          {filter.contains !== '' && ` · contains "${filter.contains}"`}
        </span>
        <form className="kv-bulk__filter" onSubmit={applyContains}>
          <input
            className="kv-bulk__contains-input"
            value={containsText}
            onChange={(event) => changeContainsText(event.target.value)}
            placeholder="contains…"
            aria-label="bulk key filter"
            title="case-sensitive substring"
            spellCheck={false}
            disabled={runMutation.isPending}
          />
          <button type="submit" className="kv-bulk__apply" disabled={runMutation.isPending}>
            apply
          </button>
        </form>
        <span className="kv-bulk__count mono-path">{formatNumber(selectedKeys.length)} keys selected</span>
      </div>

      {capped && (
        <div className="kv-bulk__hint">
          {formatNumber(selectedKeys.length)} of {formatNumber(total)} matching keys loaded — the run covers the loaded keys only
        </div>
      )}

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
              {action !== undefined &&
                (serverDelete ? kvBulkServerDeleteConfirmText(domain, filter) : kvBulkConfirmText(action, selectedKeys.length, domain))}
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
          sets an explicit null state — the key stays listed, reads answer 204{' '}
          <button type="button" className="kv-bulk__null-docs" onClick={openNullDocs}>
            docs
          </button>
        </div>
      )}

      {action !== undefined && (
        <div className="kv-bulk__call-pattern mono-path">
          {serverDelete ? `DELETE ${kvBulkDeletePath(domain, filter)}` : `${selectedKeys.length} × ${kvBulkCallPattern(action, domain, conditional)} · not recorded`}
        </div>
      )}

      {runMutation.isPending && (serverDelete || progress !== undefined) && (
        <div className="kv-bulk__progress mono-path">{serverDelete ? 'deleting…' : `${progress?.done}/${progress?.total}`}</div>
      )}

      {keysQuery.isError && <div className="kv-bulk__error">{messageOf(keysQuery.error)}</div>}
      {runMutation.isError && <div className="kv-bulk__error">{messageOf(runMutation.error)}</div>}

      {runMutation.data !== undefined &&
        (runMutation.data.kind === 'server' ? (
          <div className="kv-bulk__result">
            <div className="kv-bulk__summary">deleted {formatNumber(runMutation.data.deleted)}</div>
          </div>
        ) : (
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
        ))}
    </div>
  )
}
