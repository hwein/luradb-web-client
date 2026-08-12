import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiClient } from '../../api'
import { CallLine } from '../../lib'
import { DataHeader } from './DataHeader'
import { KvBulkBar } from './KvBulkBar'
import { KvDetail, type KvDetailMode } from './KvDetail'
import { KvMasterList } from './KvMasterList'
import { KvWatchFeed } from './KvWatchFeed'
import { invalidateKvKeys, KV_KEYS_PAGE_SIZE, kvKeysQueryOptions } from './kvEntries'

interface KvBrowserProps {
  domain: string
  apiClient: ApiClient | undefined
  initialKey: string | undefined
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/** KV-Modus des Data Browsers (spec data/002): Kopf mit Prefix-Scan/Watch-Toggle, Master-Detail, optionales Feed-Panel, Footer-CallLine. */
export function KvBrowser({ domain, apiClient, initialKey }: KvBrowserProps) {
  const queryClient = useQueryClient()
  const [prefixText, setPrefixText] = useState('')
  const [committedPrefix, setCommittedPrefix] = useState('')
  const [watchOn, setWatchOn] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(KV_KEYS_PAGE_SIZE)
  // Ankunft mit ?key= (spec data/009 §5) als Initial-State: als nachgezogener Effekt verlor die Selektion
  // gegen den Auto-Select, sobald die Key-Liste bereits im Query-Cache lag (Nachtrag data/009).
  const [mode, setMode] = useState<KvDetailMode>(() => (initialKey === undefined ? { kind: 'empty' } : { kind: 'view', key: initialKey }))

  const keysQuery = useQuery(kvKeysQueryOptions(apiClient, domain, committedPrefix))
  const keys = keysQuery.data?.keys ?? []
  const visibleKeys = keys.slice(0, visibleCount)

  // Neuer Domänen-/Prefixkontext ⇒ Auswahl verwerfen und Anzeige-Stufe zurücksetzen, dann greift Auto-Select.
  // Beim Mount übersprungen, sonst räumte er die Ankunfts-Selektion.
  const contextRef = useRef({ domain, committedPrefix })
  useEffect(() => {
    if (contextRef.current.domain === domain && contextRef.current.committedPrefix === committedPrefix) return
    contextRef.current = { domain, committedPrefix }
    setMode({ kind: 'empty' })
    setVisibleCount(KV_KEYS_PAGE_SIZE)
  }, [domain, committedPrefix])

  useEffect(() => {
    const first = visibleKeys[0]
    if (mode.kind === 'empty' && first !== undefined) setMode({ kind: 'view', key: first })
  }, [mode, visibleKeys])

  // Selektion außerhalb der Anzeige-Stufe (?key=-Ankunft tief in der Liste) ⇒ Stufe bis zur Key-Position erweitern,
  // damit die Master-Liste die Auswahl zeigt (Nachtrag data/009); die Liste scrollt selbst zur Selektion.
  useEffect(() => {
    if (mode.kind !== 'view' || keysQuery.data === undefined) return
    const index = keysQuery.data.keys.indexOf(mode.key)
    if (index >= visibleCount) setVisibleCount(Math.ceil((index + 1) / KV_KEYS_PAGE_SIZE) * KV_KEYS_PAGE_SIZE)
  }, [mode, keysQuery.data, visibleCount])

  // Frische Liste ohne den selektierten Key (delete extern / TTL-Ablauf) ⇒ Auswahl räumen — gelöscht ist gelöscht (Autor-Entscheid 2026-07-18).
  // isFetching-Guard: während eines Refetches (z. B. direkt nach create-Invalidierung) ist data noch der alte Stand — nicht darauf räumen.
  useEffect(() => {
    if (mode.kind === 'view' && !keysQuery.isFetching && keysQuery.data !== undefined && !keysQuery.data.keys.includes(mode.key))
      setMode({ kind: 'empty' })
  }, [mode, keysQuery.data, keysQuery.isFetching])

  function submitScan(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next = prefixText.trim()
    // Unveränderter Prefix wäre ein State-No-Op ohne Request — Scan soll aber immer den frischen Stand holen (z. B. nach TTL-Ablauf).
    if (next === committedPrefix) {
      invalidateKvKeys(queryClient, domain)
      return
    }
    setCommittedPrefix(next)
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
      {bulkOpen && <KvBulkBar domain={domain} apiClient={apiClient} keys={keys} prefix={committedPrefix} />}
      <div className={`data__body${watchOn ? ' data__body--watch' : ''}`}>
        <KvMasterList
          keys={visibleKeys}
          selectedKey={mode.kind === 'view' ? mode.key : undefined}
          onSelect={(key) => setMode({ kind: 'view', key })}
          onNew={() => setMode({ kind: 'new' })}
          loading={keysQuery.isLoading}
          hasMore={visibleKeys.length < keys.length}
          onLoadMore={() => setVisibleCount((count) => count + KV_KEYS_PAGE_SIZE)}
        />
        <KvDetail
          domain={domain}
          apiClient={apiClient}
          mode={mode}
          onCreated={(key) => setMode({ kind: 'view', key })}
          onClear={() => setMode({ kind: 'empty' })}
        />
        {watchOn && <KvWatchFeed domain={domain} prefix={committedPrefix} />}
      </div>
      <div className="data__footer mono-path">
        {keysQuery.data !== undefined ? (
          <>
            {formatNumber(keys.length)} keys ·{' '}
            <CallLine method={keysQuery.data.call.method} path={keysQuery.data.call.path} note={`limit ${KV_KEYS_PAGE_SIZE}`} />
          </>
        ) : keysQuery.isLoading ? (
          'loading…'
        ) : null}
      </div>
    </div>
  )
}
