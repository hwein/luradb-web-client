import type { ReactNode } from 'react'

export type EngineTone = 'json' | 'kv' | 'rel'

interface DataHeaderProps {
  tone: EngineTone
  letter: string
  path: string
  children?: ReactNode
}

/** Kopfzeile des Data Browsers (spec §1): Engine-Chip + `{domain} / <objekt>`-Pfad, Rest der Zeile ist Modus-Inhalt. */
export function DataHeader({ tone, letter, path, children }: DataHeaderProps) {
  return (
    <div className="data__header">
      <span className="data__title">
        <span className={`data__chip data__chip--${tone}`}>{letter}</span>
        {path}
      </span>
      {children}
    </div>
  )
}
