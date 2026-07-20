export interface PendingSummary {
  path: string
  from: string
  to: string
}

interface PendingBarProps {
  entries: PendingSummary[]
  onRevert: () => void
  onDownload: () => void
}

/** Sticky Pending-Bar (Prototyp Z. 358–364): Zähler, Kurzliste, Neustart-Hinweis, revert + download. */
export function PendingBar({ entries, onRevert, onDownload }: PendingBarProps) {
  const count = entries.length
  const list = entries.map((entry) => `${entry.path} ${entry.from}→${entry.to}`).join(' · ')

  return (
    <div className="config__pending">
      <span className="config__pending-count">
        {count} pending change{count === 1 ? '' : 's'}
      </span>
      <span className="config__pending-list">{list}</span>
      <span className="config__pending-note">config is read at startup — replace luradb.toml &amp; restart to apply</span>
      <button type="button" className="config__pending-revert" onClick={onRevert}>
        revert
      </button>
      <button type="button" className="config__pending-download" onClick={onDownload}>
        download updated toml ↓
      </button>
    </div>
  )
}
