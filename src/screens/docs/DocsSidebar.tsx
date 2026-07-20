import { useMemo } from 'react'
import type { RefObject } from 'react'
import { ARTICLES, searchArticles } from './articles/articles'
import { openDocs } from './openDocs'
import { setSearch } from './docsStore'

interface DocsSidebarProps {
  search: string
  activeId: string | undefined
  searchInputRef: RefObject<HTMLInputElement | null>
  serverUrl: string
}

/** Linke Spalte 250px (spec docs/001 §3): Suche + Kategorienliste, bei Suchtext stattdessen Treffer-Liste. */
export function DocsSidebar({ search, activeId, searchInputRef, serverUrl }: DocsSidebarProps) {
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
              <button key={hit.article.id} type="button" className="docs__result" onClick={() => openDocs(hit.article.id)}>
                <span className="docs__result-title">{hit.article.title}</span>
                <span className="docs__result-context">{hit.context}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <nav className="docs__nav">
          {ARTICLES.map((article) => (
            <button
              key={article.id}
              type="button"
              className={`docs__nav-item${article.id === activeId ? ' docs__nav-item--active' : ''}`}
              onClick={() => openDocs(article.id)}
            >
              {article.category}
            </button>
          ))}
        </nav>
      )}

      <div className="docs__footer">
        API reference:
        <br />
        <a href={`${serverUrl}/test-ui`} target="_blank" rel="noreferrer">
          swagger /test-ui ↗
        </a>
      </div>
    </div>
  )
}
