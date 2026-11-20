import { useMemo } from 'react'
import type { MouseEvent } from 'react'
import type { Article } from './articles/articles'
import { renderArticleBody } from './markdown'
import { openDocs } from './openDocs'

interface ArticleViewProps {
  article: Article
}

/** Article rendering: kicker, title, Markdown body, chip row. */
export function ArticleView({ article }: ArticleViewProps) {
  const html = useMemo(() => renderArticleBody(article.body), [article.body])

  // Event delegation for `docs:` links in the Markdown body; the renderer itself never navigates.
  function handleBodyClick(event: MouseEvent<HTMLDivElement>): void {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest('[data-docs-link]')
    if (!(link instanceof HTMLElement)) return
    event.preventDefault()
    const id = link.dataset.docsLink
    if (id) openDocs(id)
  }

  return (
    <div className="docs__article-inner selectable">
      <div className="docs__kicker mono-label">{article.kicker}</div>
      <h1 className="docs__title">{article.title}</h1>
      {/* Bundled articles, not user content, so injecting the HTML is safe. */}
      <div className="docs-article" onClick={handleBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
      {article.chips.length > 0 && (
        <div className="docs__chips">
          {article.chips.map((chip) => (
            <button key={chip.targetId} type="button" className="docs__chip" onClick={() => openDocs(chip.targetId)}>
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
