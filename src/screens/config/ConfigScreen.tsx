import { useMemo, useState } from 'react'
import './ConfigScreen.css'
import { ConfigCard } from './ConfigCard'
import {
  applyPending,
  applyRowEdit,
  buildConfig,
  MASKED_DISPLAY,
  type ConfigRow,
  type EditableValue,
  type PendingChange,
} from './configModel'
import { PendingBar, type PendingSummary } from './PendingBar'

const STORAGE_KEY = 'luradb.toml'

function loadStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function triggerDownload(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/toml' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function bareText(value: EditableValue): string {
  return typeof value === 'string' ? value : String(value)
}

/** Configuration-Screen (spec config/001): luradb.toml laden, als Karten anzeigen/editieren (Pending-Diff), gepatcht herunterladen. */
export function ConfigScreen() {
  const [text, setText] = useState<string>(loadStored)
  const [diff, setDiff] = useState<Map<string, PendingChange>>(() => new Map())
  const [filter, setFilter] = useState('')
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteDraft, setPasteDraft] = useState('')

  const model = useMemo(() => (text.trim() === '' ? null : buildConfig(text)), [text])

  function loadText(next: string): void {
    setText(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // best-effort (Storage voll/deaktiviert) — der In-Memory-Text bleibt maßgeblich.
    }
    setDiff(new Map())
    setEditingPath(null)
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

  function onCommit(row: ConfigRow, value: EditableValue): void {
    setDiff((current) => applyRowEdit(current, row.path, row.value as EditableValue, value))
    setEditingPath(null)
  }

  function onDownload(): void {
    triggerDownload('luradb.toml', model?.ok ? applyPending(text, diff) : text)
  }

  const summaries: PendingSummary[] = useMemo(() => {
    const rows = model?.ok ? model.rowsByPath : undefined
    return [...diff.entries()].map(([path, change]) => {
      const masked = rows?.get(path)?.masked ?? false
      return {
        path,
        from: masked ? MASKED_DISPLAY : bareText(change.old),
        to: masked ? MASKED_DISPLAY : bareText(change.new),
      }
    })
  }, [diff, model])

  const query = filter.trim().toLowerCase()

  return (
    <div className="config">
      <div className="config__header">
        <span className="config__title">luradb.toml</span>
        <span className="config__pill">click a value to edit · applied via new toml + restart</span>
        <span className="config__spacer" />
        <label className="config__action">
          open file…
          <input className="config__file-input" type="file" accept=".toml,text/plain" onChange={onFile} />
        </label>
        <button type="button" className="config__action" onClick={() => setPasteOpen((open) => !open)}>
          paste…
        </button>
        {model?.ok ? (
          <>
            <input
              className="config__filter"
              placeholder="filter keys…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <button type="button" className="config__action" onClick={onDownload}>
              download toml ↓
            </button>
          </>
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
          <p className="config__notice">no toml loaded — the server reads luradb.toml at startup; load yours to view &amp; edit</p>
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
              <ConfigCard
                key={entry.card.id}
                card={entry.card}
                rows={entry.rows}
                diff={diff}
                editingPath={editingPath}
                onStartEdit={setEditingPath}
                onCancelEdit={() => setEditingPath(null)}
                onCommit={onCommit}
              />
            ))}
        </div>
      )}

      {model?.ok && summaries.length > 0 ? (
        <PendingBar entries={summaries} onRevert={() => setDiff(new Map())} onDownload={onDownload} />
      ) : null}
    </div>
  )
}
