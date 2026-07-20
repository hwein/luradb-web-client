import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { ArticleView } from './ArticleView'
import './DocsScreen.css'
import { DocsSidebar } from './DocsSidebar'
import { DocsTabs } from './DocsTabs'
import { getArticle } from './articles/articles'
import { useDocsState } from './docsStore'

function hasFocusSearch(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false
  return (state as { focusSearch?: unknown }).focusSearch === true
}

/** Docs-Bereich (spec docs/001 §3): Tab-Strip + Suche/Kategorien + Artikel, Tab-/Suchzustand im Docs-Store. */
export function DocsScreen() {
  const { tabs, activeId, search } = useDocsState()
  const location = useLocation()
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const session = useSession()
  const serverUrl = session.status === 'connected' ? session.connection.type.url : window.location.origin

  // F1 (shell/001) trägt {focusSearch:true} als Router-State — Suchfeld fokussieren und den State danach
  // nicht erneut anwenden, sonst refokussiert jeder Re-Render.
  useEffect(() => {
    if (hasFocusSearch(location.state)) {
      searchInputRef.current?.focus()
      void navigate('.', { replace: true, state: null })
    }
  }, [location, navigate])

  const activeArticle = activeId ? getArticle(activeId) : undefined

  return (
    <div className="docs">
      <DocsTabs tabs={tabs} activeId={activeId} />
      <div className="docs__body">
        <DocsSidebar search={search} activeId={activeId} searchInputRef={searchInputRef} serverUrl={serverUrl} />
        <div className="docs__article">
          {activeArticle ? <ArticleView article={activeArticle} /> : <div className="docs__empty">Pick an article from the list to start reading.</div>}
        </div>
      </div>
    </div>
  )
}
