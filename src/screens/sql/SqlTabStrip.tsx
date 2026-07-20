import { useState } from 'react'
import type { SqlTab } from './sqlStore'

interface SqlTabStripProps {
  tabs: SqlTab[]
  activeId: string
  domainName: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onAdd: () => void
}

/** Editor-Tab-Strip (Prototyp Z. 63–66): aktiver Tab auf `--edbg` mit Top-Border, Umbenennen per Doppelklick, × schließt. */
export function SqlTabStrip({ tabs, activeId, domainName, onSelect, onClose, onRename, onAdd }: SqlTabStripProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(tab: SqlTab): void {
    setEditingId(tab.id)
    setDraft(tab.name)
  }

  function commitEdit(): void {
    if (editingId !== null) onRename(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className="sql-tabs">
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <div
            key={tab.id}
            className={`sql-tab${active ? ' sql-tab--active' : ''}`}
            onClick={() => onSelect(tab.id)}
            role="tab"
            aria-selected={active}
            tabIndex={-1}
          >
            {editingId === tab.id ? (
              <input
                className="sql-tab__rename"
                value={draft}
                autoFocus
                aria-label="rename tab"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitEdit()
                  } else if (event.key === 'Escape') {
                    setEditingId(null)
                  }
                }}
              />
            ) : (
              <span className="sql-tab__label" onDoubleClick={() => startEdit(tab)}>
                {domainName !== null && <span className="sql-tab__domain">{domainName} · </span>}
                {tab.name}
              </span>
            )}
            <span
              className="sql-tab__close"
              role="button"
              aria-label={`close ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
            >
              ×
            </span>
          </div>
        )
      })}
      <button type="button" className="sql-tab__add" aria-label="new tab" onClick={onAdd}>
        +
      </button>
    </div>
  )
}
