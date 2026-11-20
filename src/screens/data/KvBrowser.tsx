import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiClient } from '../../api'
import { CallLine, formatNumber } from '../../lib'
import { DataHeader } from './DataHeader'
import { KvBulkBar } from './KvBulkBar'
import { KvDetail, type KvDetailMode } from './KvDetail'
import { KvMasterList } from './KvMasterList'
import { KvWatchFeed } from './KvWatchFeed'
import { EMPTY_KV_KEY_FILTER, invalidateKvKeys, kvKeysQueryOptions, type KvKeyFilter } from './kvEntries'

interface KvBrowserProps {
  domain: string
  apiClient: ApiClient | undefined
  initialKey: string | undefined
}

/** KV mode of the data browser: header with prefix/contains scan and watch toggle, master-detail, optional feed panel, footer CallLine. */
export function KvBrowser({ domain, apiClient, initialKey }: KvBrowserProps) {
  const queryClient = useQueryClient()
  const [prefixText, setPrefixText] = useState('')
  const [containsText, setContainsText] = useState('')
  const [committed, setCommitted] = useState<KvKeyFilter>(EMPTY_KV_KEY_FILTER)
  const [watchOn, setWatchOn] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  // Arrival with ?key= as initial state: as a follow-up effect the selection lost
  // against auto-select once the key list was already in the query cache.
  const [mode, setMode] = useState<KvDetailMode>(() => (initialKey === undefined ? { kind: 'empty' } : { kind: 'view', key: initialKey }))

  // Stable, as KvDetail uses it as an effect dependency (404 clearing).
  const clearMode = useCallback(() => setMode({ kind: 'empty' }), [])

  const keysQuery = useInfiniteQuery(kvKeysQueryOptions(apiClient, domain, committed))
  const pages = keysQuery.data?.pages ?? []
  const keys = pages.flatMap((page) => page.keys)
  const lastPage = pages[pages.length - 1]

  // New domain/filter context ⇒ drop the selection, then auto-select applies.
  // Skipped on mount, otherwise it would clear the arrival selection.
  const contextRef = useRef({ domain, committed })
  useEffect(() => {
    if (contextRef.current.domain === domain && contextRef.current.committed === committed) return
    contextRef.current = { domain, committed }
    setMode({ kind: 'empty' })
  }, [domain, committed])

  // Not during a refetch: after a value 404 KvDetail clears the selection and invalidates the list;
  // the still-old list would select the same key again at once (loop until the fresh page).
  useEffect(() => {
    const first = keys[0]
    if (mode.kind === 'empty' && first !== undefined && !keysQuery.isFetching) setMode({ kind: 'view', key: first })
  }, [mode, keys, keysQuery.isFetching])

  function submitScan(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next: KvKeyFilter = { prefix: prefixText.trim(), contains: containsText.trim() }
    // Unchanged filters would be a state no-op without a request, but a scan must always fetch fresh data (e.g. after a TTL expiry).
    // The open detail follows (value + metadata): only its 404 clears the selection; with pagination the list proves nothing anymore.
    if (next.prefix === committed.prefix && next.contains === committed.contains) {
      invalidateKvKeys(queryClient, domain)
      void queryClient.invalidateQueries({ queryKey: ['kv-value', domain] })
      void queryClient.invalidateQueries({ queryKey: ['kv-meta', domain] })
      return
    }
    setCommitted(next)
  }

  return (
    <div className="data">
      <DataHeader tone="kv" letter="K" path={`${domain} / kv keys`}>
        <form className="kv__scan" onSubmit={submitScan}>
          <input
            className="kv__prefix-input"
            value={prefixText}
            onChange={(event) => setPrefixText(event.target.value)}
            placeholder="prefix…"
            aria-label="key prefix"
            spellCheck={false}
          />
          <input
            className="kv__contains-input"
            value={containsText}
            onChange={(event) => setContainsText(event.target.value)}
            placeholder="contains…"
            aria-label="key contains"
            title="case-sensitive substring"
            spellCheck={false}
          />
          <button type="submit" className="kv__scan-button">
            Scan
          </button>
        </form>
        <button
          type="button"
          className={`kv__bulk-toggle${bulkOpen ? ' kv__bulk-toggle--active' : ''}`}
          onClick={() => setBulkOpen((value) => !value)}
          aria-pressed={bulkOpen}
        >
          bulk…
        </button>
        <button
          type="button"
          className={`kv__watch-toggle${watchOn ? ' kv__watch-toggle--active' : ''}`}
          onClick={() => setWatchOn((value) => !value)}
          aria-pressed={watchOn}
        >
          ● live
        </button>
      </DataHeader>
      {bulkOpen && (
        <KvBulkBar key={JSON.stringify(committed)} domain={domain} apiClient={apiClient} scan={committed} />
      )}
      <div className={`data__body${watchOn ? ' data__body--watch' : ''}`}>
        <KvMasterList
          keys={keys}
          selectedKey={mode.kind === 'view' ? mode.key : undefined}
          onSelect={(key) => setMode({ kind: 'view', key })}
          onNew={() => setMode({ kind: 'new' })}
          loading={keysQuery.isLoading}
          hasMore={keysQuery.hasNextPage}
          loadingMore={keysQuery.isFetchingNextPage}
          onLoadMore={() => void keysQuery.fetchNextPage()}
        />
        <KvDetail
          domain={domain}
          apiClient={apiClient}
          mode={mode}
          onCreated={(key) => setMode({ kind: 'view', key })}
          onClear={clearMode}
        />
        {watchOn && <KvWatchFeed domain={domain} prefix={committed.prefix} />}
      </div>
      <div className="data__footer mono-path">
        {lastPage !== undefined ? (
          <>
            {formatNumber(keys.length)} of {formatNumber(lastPage.total)} keys · <CallLine method={lastPage.call.method} path={lastPage.call.path} />
          </>
        ) : keysQuery.isLoading ? (
          'loading…'
        ) : null}
      </div>
    </div>
  )
}
