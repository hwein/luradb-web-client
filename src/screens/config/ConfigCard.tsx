import type { ConfigCard as ConfigCardModel, ConfigRow, EditableValue, PendingDiff } from './configModel'
import { ConfigValueRow } from './ConfigValueRow'

interface ConfigCardProps {
  card: ConfigCardModel
  rows: ConfigRow[]
  diff: PendingDiff
  editingPath: string | null
  onStartEdit: (path: string) => void
  onCancelEdit: () => void
  onCommit: (row: ConfigRow, value: EditableValue) => void
}

/** Eine Sektions-Karte (Prototyp Z. 287–356): Kopf mit `[sektion]`-Titel, darunter die Wert-Zeilen. */
export function ConfigCard({ card, rows, diff, editingPath, onStartEdit, onCancelEdit, onCommit }: ConfigCardProps) {
  return (
    <div className="config-card">
      <div className="config-card__head">{card.title}</div>
      <div className="config-card__rows">
        {rows.map((row) => (
          <ConfigValueRow
            key={row.path}
            row={row}
            pending={diff.get(row.path)}
            editing={editingPath === row.path}
            onStartEdit={() => onStartEdit(row.path)}
            onCancelEdit={onCancelEdit}
            onCommit={(value) => onCommit(row, value)}
          />
        ))}
      </div>
    </div>
  )
}
