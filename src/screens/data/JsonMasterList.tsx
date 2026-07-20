import type { DocumentSummary } from './jsonDocuments'

interface JsonMasterListProps {
  documents: DocumentSummary[]
  selectedKey: string | undefined
  onSelect: (key: string) => void
  onNew: () => void
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

/** Master-Liste (spec §3): key/preview/ver, Auswahl per 2px-Accent-Border, offset-basiertes "load more". */
export function JsonMasterList({ documents, selectedKey, onSelect, onNew, loading, hasMore, loadingMore, onLoadMore }: JsonMasterListProps) {
  return (
    <div className="json-list">
      <div className="json-list__head">
        <span className="json-list__key">key</span>
        <span className="json-list__preview">preview</span>
        <span className="json-list__ver">ver</span>
        <button type="button" className="json-list__new" onClick={onNew}>
          + new
        </button>
      </div>
      {loading ? (
        <div className="json-list__hint">loading…</div>
      ) : documents.length === 0 ? (
        <div className="json-list__hint">no documents</div>
      ) : (
        documents.map((doc) => (
          <button
            key={doc.key}
            type="button"
            className={`json-list__row${doc.key === selectedKey ? ' json-list__row--selected' : ''}`}
            onClick={() => onSelect(doc.key)}
          >
            <span className="json-list__key">{doc.key}</span>
            <span className="json-list__preview">{doc.preview}</span>
            <span className="json-list__ver">v{doc.version}</span>
          </button>
        ))
      )}
      {hasMore && (
        <button type="button" className="json-list__load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'loading…' : 'load more'}
        </button>
      )}
    </div>
  )
}
