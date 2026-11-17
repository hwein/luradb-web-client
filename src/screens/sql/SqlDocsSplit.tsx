import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { DOCS_HOST, getDocEntry, resolveSitePage } from '../docs/articles/articles'
import { SitePageView } from '../docs/SitePageView'
import { openDocs } from '../docs'

interface SqlDocsSplitProps {
  articleId: string
  onArticleChange: (id: string) => void
  onClose: () => void
}

/** Docs split (prototype lines 91–109): the fetched site page of a topic, search field, "open full docs tab →". */
export function SqlDocsSplit({ articleId, onArticleChange, onClose }: SqlDocsSplitProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [clicked, setClicked] = useState<{ id: string; anchor: string | undefined }>()
  const id = resolveSitePage(articleId) ? articleId : 'lurasql'
  // A clicked anchor applies to the page it was clicked for; otherwise the topic's own anchor.
  const anchor = (clicked?.id === id ? clicked.anchor : undefined) ?? resolveSitePage(id)?.anchor

  function openPage(nextId: string, nextAnchor?: string): void {
    setClicked({ id: nextId, anchor: nextAnchor })
    onArticleChange(nextId)
  }

  function openFull(): void {
    openDocs(id)
    void navigate('/docs')
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const trimmed = query.trim()
    if (trimmed === '') return
    openDocs({ search: trimmed })
    void navigate('/docs')
  }

  return (
    <aside className="sql-docs">
      <div className="sql-docs__head">
        <span>◈ docs · {getDocEntry(id)?.category ?? DOCS_HOST}</span>
        <button type="button" className="sql-docs__close" aria-label="close docs" onClick={onClose}>
          ×
        </button>
      </div>
      <form className="sql-docs__search" onSubmit={submitSearch}>
        <input
          placeholder="Search docs…  F1"
          aria-label="search docs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <div className="sql-docs__body">
        <SitePageView id={id} anchor={anchor} heading={false} onOpen={openPage} />
        <button type="button" className="sql-docs__full" onClick={openFull}>
          open full docs tab →
        </button>
      </div>
    </aside>
  )
}
