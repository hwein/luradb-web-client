import type { ConfigCard as ConfigCardModel, ConfigRow } from './configModel'
import { ConfigValueRow } from './ConfigValueRow'

interface ConfigCardProps {
  card: ConfigCardModel
  rows: ConfigRow[]
}

/** Eine Sektions-Karte (Prototyp Z. 287–356): Kopf mit `[sektion]`-Titel, darunter die Wert-Zeilen. */
export function ConfigCard({ card, rows }: ConfigCardProps) {
  return (
    <div className="config-card">
      <div className="config-card__head">{card.title}</div>
      <div className="config-card__rows">
        {rows.map((row) => (
          <ConfigValueRow key={row.path} row={row} />
        ))}
      </div>
    </div>
  )
}
