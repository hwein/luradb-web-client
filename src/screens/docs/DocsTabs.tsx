import { useEffect, useRef } from 'react'
import { getDocEntry, resolveSitePage } from './articles/articles'
import { activateTab, closeTab } from './docsStore'

interface DocsTabsProps {
  tabs: string[]
  activeId: string | undefined
}

/** Tab-Strip (spec docs/001 §3): `◈ docs://<id>`, aktiver Tab `--edbg`. */
export function DocsTabs({ tabs, activeId }: DocsTabsProps) {
  const activeRef = useRef<HTMLDivElement>(null)
  const visible = tabs.length > 0
  // 'nearest' leaves the content area's vertical position alone; the optional call is for jsdom.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId, visible])

  if (!visible) return null

  return (
    <div className="docs__tabs">
      {tabs.map((id) => {
        if (!getDocEntry(id) && !resolveSitePage(id)) return null
        const active = id === activeId
        return (
          <div key={id} ref={active ? activeRef : undefined} className={`docs__tab${active ? ' docs__tab--active' : ''}`}>
            <button type="button" className="docs__tab-label" onClick={() => activateTab(id)}>
              ◈ docs://{id.replace(/^\/+|\/+$/g, '')}
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
