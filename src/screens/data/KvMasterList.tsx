import { useEffect, useRef } from 'react'

interface KvMasterListProps {
  keys: string[]
  selectedKey: string | undefined
  onSelect: (key: string) => void
  onNew: () => void
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

/** Master-Liste (spec §2): Key-Liste aus dem serverseitigen Scan, Auswahl per 2px-Accent-Border, offset-basiertes "load more" (spec data/011). */
export function KvMasterList({ keys, selectedKey, onSelect, onNew, loading, hasMore, loadingMore, onLoadMore }: KvMasterListProps) {
  // Einmal je Selektion zur Zeile scrollen, sobald sie gerendert ist (?key=-Ankunft liegt tief in der Liste);
  // 'nearest' macht sichtbare Zeilen zum No-Op, und "load more" scrollt nie zurück (scrolledFor-Guard).
  const selectedRef = useRef<HTMLButtonElement>(null)
  const scrolledForRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (selectedKey === undefined || scrolledForRef.current === selectedKey || selectedRef.current === null) return
    scrolledForRef.current = selectedKey
    selectedRef.current.scrollIntoView?.({ block: 'nearest' })
  }, [selectedKey, keys])

  return (
    <div className="kv-list">
      <div className="kv-list__head">
        <span className="kv-list__label">key</span>
        <button type="button" className="kv-list__new" onClick={onNew}>
          + new
        </button>
      </div>
      {loading ? (
        <div className="kv-list__hint">loading…</div>
      ) : keys.length === 0 ? (
        <div className="kv-list__hint">no keys</div>
      ) : (
        // Index im React-Key: Offset-Paging kann bei parallelen Writes dieselbe Zeile auf zwei Seiten liefern (kvEntries.ts).
        keys.map((key, index) => (
          <button
            key={`${index}:${key}`}
            ref={key === selectedKey ? selectedRef : undefined}
            type="button"
            className={`kv-list__row${key === selectedKey ? ' kv-list__row--selected' : ''}`}
            onClick={() => onSelect(key)}
          >
            {key}
          </button>
        ))
      )}
      {hasMore && (
        <button type="button" className="kv-list__load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'loading…' : 'load more'}
        </button>
      )}
    </div>
  )
}
