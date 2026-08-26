import type { ConfigRow } from './configModel'

interface ConfigValueRowProps {
  row: ConfigRow
}

/** Eine Key/Wert-Zeile: reine Anzeige (spec config/003 — kein Edit-Einstieg). */
export function ConfigValueRow({ row }: ConfigValueRowProps) {
  let valueClass = 'config-row__value'
  if (row.masked) valueClass += ' config-row__value--masked'
  if (row.kind === 'boolean') valueClass += ' config-row__value--bool'

  return (
    <div className="config-row">
      <span className="config-row__key">{row.label}</span>
      <span className={valueClass}>{row.display}</span>
      {row.masked ? <span className="config-row__warn">⚠</span> : null}
    </div>
  )
}
