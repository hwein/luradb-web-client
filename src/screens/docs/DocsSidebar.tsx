import { useMemo } from 'react'
import type { RefObject } from 'react'
import { DOC_ENTRIES, searchArticles } from './articles/articles'
import { openDocs } from './openDocs'
import { setSearch } from './docsStore'

interface DocsSidebarProps {
  search: string
  activeId: string | undefined
  searchInputRef: RefObject<HTMLInputElement | null>
}

/** Left column, 270px: search and category list; with a search text the hit list instead. */
export function DocsSidebar({ search, activeId, searchInputRef }: DocsSidebarProps) {
  const hits = useMemo(() => searchArticles(search), [search])
  const isSearching = search.trim() !== ''

  return (
    <div className="docs__sidebar">
      <div className="docs__search">
        <input
          ref={searchInputRef}
          className="docs__search-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search docs…  F1"
          aria-label="search docs"
          spellCheck={false}
        />
      </div>

      {isSearching ? (
        <div className="docs__results">
          {hits.length === 0 ? (
            <div className="docs__results-empty">no matches</div>
          ) : (
            hits.map((hit) => (
              <button key={hit.entry.id} type="button" className="docs__result" onClick={() => openDocs(hit.entry.id)}>
                <span className="docs__result-title">{hit.entry.title}</span>
                <span className="docs__result-context">{hit.context}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <nav className="docs__nav">
          {DOC_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`docs__nav-item${entry.id === activeId ? ' docs__nav-item--active' : ''}`}
              onClick={() => openDocs(entry.id)}
            >
              {entry.category}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
