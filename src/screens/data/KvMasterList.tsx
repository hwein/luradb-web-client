interface KvMasterListProps {
  keys: string[]
  selectedKey: string | undefined
  onSelect: (key: string) => void
  onNew: () => void
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
}

/** Master-Liste (spec §2): reine Key-Liste aus dem Prefix-Scan, Auswahl per 2px-Accent-Border. "load more" ist eine
 *  sofortige Client-Slice (der Scan lädt bereits alle Treffer, keine Server-Paginierung — s. kvEntries.ts). */
export function KvMasterList({ keys, selectedKey, onSelect, onNew, loading, hasMore, onLoadMore }: KvMasterListProps) {
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
        keys.map((key) => (
          <button
            key={key}
            type="button"
            className={`kv-list__row${key === selectedKey ? ' kv-list__row--selected' : ''}`}
            onClick={() => onSelect(key)}
          >
            {key}
          </button>
        ))
      )}
      {hasMore && (
        <button type="button" className="kv-list__load-more" onClick={onLoadMore}>
          load more
        </button>
      )}
    </div>
  )
}
