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

/** Master list: keys from the server-side scan, the selected row keeps the hover surface, offset-based "load more". */
export function KvMasterList({ keys, selectedKey, onSelect, onNew, loading, hasMore, loadingMore, onLoadMore }: KvMasterListProps) {
  // Scroll to the row once per selection as soon as it is rendered (a ?key= arrival can sit deep in the list);
  // 'nearest' makes visible rows a no-op, and "load more" never scrolls back (scrolledFor guard).
  const selectedRef = useRef<HTMLButtonElement>(null)
  const scrolledForRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (selectedKey === undefined || scrolledForRef.current === selectedKey || selectedRef.current === null) return
    scrolledForRef.current = selectedKey
    selectedRef.current.scrollIntoView?.({ block: 'nearest' })
  }, [selectedKey, keys])

  return (
    <div className="kv-list selectable">
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
        // Index in the React key: offset paging can return the same row on two pages under parallel writes (kvEntries.ts).
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
