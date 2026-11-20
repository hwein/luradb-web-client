import type { ReactNode } from 'react'

export type EngineTone = 'json' | 'kv' | 'rel'

interface DataHeaderProps {
  tone: EngineTone
  letter: string
  path: string
  children?: ReactNode
}

/** Data browser header: engine chip + `{domain} / <object>` path; the rest of the row is mode content. */
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
