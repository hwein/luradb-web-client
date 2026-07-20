import { getArticle } from './articles/articles'
import { activateTab, closeTab } from './docsStore'

interface DocsTabsProps {
  tabs: string[]
  activeId: string | undefined
}

/** Tab-Strip (spec docs/001 §3): `◈ docs://<id>`, aktiver Tab `--edbg`. */
export function DocsTabs({ tabs, activeId }: DocsTabsProps) {
  if (tabs.length === 0) return null

  return (
    <div className="docs__tabs">
      {tabs.map((id) => {
        const article = getArticle(id)
        if (!article) return null
        const active = id === activeId
        return (
          <div key={id} className={`docs__tab${active ? ' docs__tab--active' : ''}`}>
            <button type="button" className="docs__tab-label" onClick={() => activateTab(id)}>
              ◈ docs://{id}
            </button>
            <button type="button" className="docs__tab-close" aria-label={`close ${id}`} onClick={() => closeTab(id)}>
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
