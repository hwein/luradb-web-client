import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArticleView } from './ArticleView'
import './DocsScreen.css'
import { DocsSidebar } from './DocsSidebar'
import { DocsTabs } from './DocsTabs'
import { SitePageView } from './SitePageView'
import { getArticle, resolveSitePage } from './articles/articles'
import { openArticle, useDocsState } from './docsStore'

function hasFocusSearch(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false
  return (state as { focusSearch?: unknown }).focusSearch === true
}

/** Docs area: tab strip, search/categories and article; tab and search state live in the docs store. */
export function DocsScreen() {
  const { tabs, activeId, search, anchors } = useDocsState()
  const location = useLocation()
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // F1 carries {focusSearch:true} as router state: focus the search field, then clear the state so
  // it is not applied again on every re-render.
  useEffect(() => {
    if (hasFocusSearch(location.state)) {
      searchInputRef.current?.focus()
      void navigate('.', { replace: true, state: null })
    }
  }, [location, navigate])

  const activeArticle = activeId ? getArticle(activeId) : undefined
  const sitePageId = activeId !== undefined && !activeArticle && resolveSitePage(activeId) ? activeId : undefined

  return (
    <div className="docs">
      <DocsTabs tabs={tabs} activeId={activeId} />
      <div className="docs__body">
        <DocsSidebar search={search} activeId={activeId} searchInputRef={searchInputRef} />
        <div className="docs__article">
          {activeArticle ? (
            <ArticleView article={activeArticle} />
          ) : sitePageId !== undefined ? (
            <SitePageView id={sitePageId} anchor={anchors[sitePageId]} onOpen={openArticle} />
          ) : (
            <div className="docs__empty">Pick an article from the list to start reading.</div>
          )}
        </div>
      </div>
    </div>
  )
}
