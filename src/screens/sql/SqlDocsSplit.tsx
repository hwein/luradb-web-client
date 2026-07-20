import { useMemo, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { getArticle } from '../docs/articles/articles'
import { renderArticleBody } from '../docs/markdown'
import { openDocs } from '../docs'

interface SqlDocsSplitProps {
  articleId: string
  onArticleChange: (id: string) => void
  onClose: () => void
}

/** Docs-Split (Prototyp Z. 91–109): kondensierter Artikel via docs/001-Renderer, Suchfeld, „open full docs tab →". */
export function SqlDocsSplit({ articleId, onArticleChange, onClose }: SqlDocsSplitProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const article = getArticle(articleId) ?? getArticle('cross-engine-links')
  const html = useMemo(() => renderArticleBody(article?.body ?? ''), [article])

  // Interne `docs:`-Links wechseln den Split-Artikel; unbekannte Ziele eskalieren in den Docs-Bereich.
  function handleBodyClick(event: MouseEvent<HTMLDivElement>): void {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest('[data-docs-link]')
    if (!(link instanceof HTMLElement)) return
    event.preventDefault()
    const id = link.dataset.docsLink
    if (!id) return
    if (getArticle(id)) {
      onArticleChange(id)
    } else {
      openDocs(id)
      void navigate('/docs')
    }
  }

  function openFull(): void {
    if (article) openDocs(article.id)
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
        <span>◈ docs · {article?.kicker ?? articleId}</span>
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
        {/* Gebündelte Artikel (docs/001), kein User-Content — Renderer identisch zu ArticleView. */}
        <div className="docs-article" onClick={handleBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
        <button type="button" className="sql-docs__full" onClick={openFull}>
          open full docs tab →
        </button>
      </div>
    </aside>
  )
}
