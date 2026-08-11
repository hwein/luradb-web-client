import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../app/session'
import { ARTICLES } from '../screens/docs/articles/articles'
import { openDocs } from '../screens/docs/openDocs'
import { openDomainIn } from '../screens/engines/EnginesScreen'
import './CommandPalette.css'
import { useDomainSummaries, type DomainSummary } from './domains'
import { paletteEntries, type PaletteEntry, type PaletteGroup } from './paletteEntries'
import { ROUTES } from './Rail'
import { useSelectedDomain } from './SelectedDomainContext'

/** T/J/K-Vokabular wie ExpandedDomain/Explorer (spec shell/008 §3) — Priorität fürs Ziel, wenn eine Domäne mehrere Engines hat. */
function primaryEngine(domain: DomainSummary): 'rel' | 'json' | 'kv' | undefined {
  if (domain.engines.rel) return 'rel'
  if (domain.engines.json) return 'json'
  if (domain.engines.kv) return 'kv'
  return undefined
}

function entryKey(entry: PaletteEntry): string {
  if (entry.kind === 'screen') return `screen:${entry.path}`
  if (entry.kind === 'domain') return `domain:${entry.domain.name}`
  return `doc:${entry.id}`
}

function PaletteRow({ entry, active, onRun }: { entry: PaletteEntry; active: boolean; onRun: () => void }) {
  return (
    <button type="button" className={`cmdk__row${active ? ' cmdk__row--active' : ''}`} onClick={onRun}>
      {entry.kind === 'screen' && <span className="cmdk__row-name">{entry.title}</span>}
      {entry.kind === 'domain' && (
        <>
          <span className="cmdk__row-name">{entry.domain.name}</span>
          <span className="cmdk__chips">
            {entry.domain.engines.rel && <span className="cmdk__chip cmdk__chip--rel">T</span>}
            {entry.domain.engines.json && <span className="cmdk__chip cmdk__chip--json">J</span>}
            {entry.domain.engines.kv && <span className="cmdk__chip cmdk__chip--kv">K</span>}
          </span>
        </>
      )}
      {entry.kind === 'doc' && (
        <>
          <span className="cmdk__row-name">{entry.title}</span>
          <span className="cmdk__row-meta">{entry.category}</span>
        </>
      )}
    </button>
  )
}

interface CommandPaletteContentProps {
  onClose: () => void
}

/** Inhalt der Command-Palette (spec shell/008) — ohne <dialog>-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
export function CommandPaletteContent({ onClose }: CommandPaletteContentProps) {
  const navigate = useNavigate()
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const domains = useDomainSummaries(apiClient)
  const { select } = useSelectedDomain()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const screens = ROUTES.map((route) => ({ path: route.path, title: route.title }))
  const groups: PaletteGroup[] = paletteEntries(query, screens, domains, ARTICLES, apiClient !== undefined)
  const flatEntries = groups.flatMap((group) => group.entries)
  const activeIndex = flatEntries.length === 0 ? 0 : Math.min(selectedIndex, flatEntries.length - 1)

  function runEntry(entry: PaletteEntry): void {
    if (entry.kind === 'screen') {
      void navigate(entry.path)
    } else if (entry.kind === 'domain') {
      const engine = primaryEngine(entry.domain)
      if (engine !== undefined) openDomainIn(navigate, select, entry.domain.name, engine)
    } else {
      openDocs(entry.id)
      void navigate('/docs')
    }
    onClose()
  }

  let cursor = 0

  return (
    <>
      <input
        className="cmdk__input"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelectedIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelectedIndex(Math.min(activeIndex + 1, Math.max(flatEntries.length - 1, 0)))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelectedIndex(Math.max(activeIndex - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const entry = flatEntries[activeIndex]
            if (entry) runEntry(entry)
          }
        }}
        placeholder="Search screens, domains, docs…"
        aria-label="command palette search"
        spellCheck={false}
      />
      <div className="cmdk__results">
        {groups.map((group) => {
          if (group.entries.length === 0 && group.emptyMessage === undefined) return null
          return (
            <div key={group.label} className="cmdk__group">
              <div className="cmdk__group-label mono-label">{group.label}</div>
              {group.entries.length === 0 && group.emptyMessage !== undefined ? (
                <div className="cmdk__empty-row">{group.emptyMessage}</div>
              ) : (
                group.entries.map((entry) => {
                  const index = cursor
                  cursor += 1
                  return <PaletteRow key={entryKey(entry)} entry={entry} active={index === activeIndex} onRun={() => runEntry(entry)} />
                })
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

interface CommandPaletteProps {
  onClose: () => void
}

/** Command-Palette (spec shell/008): natives `<dialog>` + `showModal()` um `CommandPaletteContent`, Backdrop-Klick schließt zusätzlich. */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // `open`-Guard: der StrictMode-Zweitlauf trifft einen bereits offenen Dialog — showModal() würfe dann,
    // bevor der close-Listener registriert ist.
    if (!dialog.open) {
      dialog.showModal()
      dialog.querySelector('input')?.focus()
    }
    function handleClose(): void {
      onCloseRef.current()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="cmdk"
      aria-label="command palette"
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <CommandPaletteContent onClose={onClose} />
    </dialog>
  )
}
