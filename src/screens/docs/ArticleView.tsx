import { useMemo } from 'react'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import type { Article } from './articles/articles'
import { renderArticleBody } from './markdown'
import { openDocs } from './openDocs'

interface ArticleViewProps {
  article: Article
}

/** Artikel-Rendering (spec docs/001 §3): Kicker, Titel, Markdown-Rumpf, Chip-Zeile. */
export function ArticleView({ article }: ArticleViewProps) {
  const navigate = useNavigate()
  const html = useMemo(() => renderArticleBody(article.body), [article.body])

  // Event-Delegation für `docs:`-Links im Markdown-Rumpf (orchestrator hint #2) — der Renderer selbst
  // führt keine Navigation aus.
  function handleBodyClick(event: MouseEvent<HTMLDivElement>): void {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest('[data-docs-link]')
    if (!(link instanceof HTMLElement)) return
    event.preventDefault()
    const id = link.dataset.docsLink
    if (id) openDocs(id)
  }

  return (
    <div className="docs__article-inner">
      <div className="docs__kicker mono-label">{article.kicker}</div>
      <h1 className="docs__title">{article.title}</h1>
      {/* Eigene, gebündelte Artikel (spec docs/001 §4) — kein User-Content, daher unbedenklich. */}
      <div className="docs-article" onClick={handleBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
      {article.chips.length > 0 && (
        <div className="docs__chips">
          {article.chips.map((chip) => (
            <button
              key={chip.kind === 'console' ? 'console' : `related-${chip.targetId}`}
              type="button"
              className={`docs__chip${chip.kind === 'console' ? ' docs__chip--acc' : ''}`}
              onClick={() => {
                if (chip.kind === 'console') {
                  void navigate('/sql', { state: { insertQuery: chip.query } })
                } else {
                  openDocs(chip.targetId)
                }
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
