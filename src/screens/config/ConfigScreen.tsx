import { useEffect, useMemo, useState } from 'react'
import './ConfigScreen.css'
import { ConfigCard } from './ConfigCard'
import { buildConfig } from './configModel'

// Alt-Key aus der entfernten Edit-Persistenz (spec config/003 §5) — enthielt den Klartext samt api_key.
const LEGACY_STORAGE_KEY = 'luradb.toml'

/** Configuration-Screen (spec config/003): luradb.toml laden und als Karten anzeigen — read-only. */
export function ConfigScreen() {
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteDraft, setPasteDraft] = useState('')

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // best-effort (Storage deaktiviert) — Cleanup ist optional.
    }
  }, [])

  const model = useMemo(() => (text.trim() === '' ? null : buildConfig(text)), [text])

  function loadText(next: string): void {
    setText(next)
    setPasteOpen(false)
    setPasteDraft('')
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') loadText(reader.result)
    }
    reader.readAsText(file)
  }

  const query = filter.trim().toLowerCase()

  return (
    <div className="config">
      <div className="config__header">
        <span className="config__title">luradb.toml</span>
        <span className="config__pill">read-only view · edit luradb.toml on the server &amp; restart</span>
        <span className="config__spacer" />
        <label className="config__action">
          open file…
          <input className="config__file-input" type="file" accept=".toml,text/plain" onChange={onFile} />
        </label>
        <button type="button" className="config__action" onClick={() => setPasteOpen((open) => !open)}>
          paste…
        </button>
        {model?.ok ? (
          <input
            className="config__filter"
            placeholder="filter keys…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}
      </div>

      {pasteOpen ? (
        <div className="config__paste">
          <textarea
            className="config__paste-area"
            placeholder="paste luradb.toml contents…"
            value={pasteDraft}
            onChange={(event) => setPasteDraft(event.target.value)}
          />
          <div className="config__paste-actions">
            <button
              type="button"
              className="config__paste-apply"
              disabled={pasteDraft.trim() === ''}
              onClick={() => loadText(pasteDraft)}
            >
              load pasted toml
            </button>
            <button type="button" className="config__paste-cancel" onClick={() => setPasteOpen(false)}>
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {model === null ? (
        <div className="config__empty">
          <p className="config__notice">no toml loaded — the server reads luradb.toml at startup; load yours to view it</p>
        </div>
      ) : !model.ok ? (
        <div className="config__error">
          <p className="config__notice config__notice--error">
            could not parse toml{model.line !== undefined ? ` (line ${model.line})` : ''}: {model.message}
          </p>
        </div>
      ) : (
        <div className="config__grid">
          {model.cards
            .map((card) => ({
              card,
              rows: query === '' ? card.rows : card.rows.filter((row) => row.path.toLowerCase().includes(query)),
            }))
            .filter((entry) => entry.rows.length > 0)
            .map((entry) => (
              <ConfigCard key={entry.card.id} card={entry.card} rows={entry.rows} />
            ))}
        </div>
      )}
    </div>
  )
}
