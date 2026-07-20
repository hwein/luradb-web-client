export type EngineTone = 'kv' | 'json' | 'rel'

export interface EngineCardRow {
  label: string
  value: string
}

interface EngineCardProps {
  tone: EngineTone
  title: string
  online: boolean
  rows: EngineCardRow[]
  domains: string[]
  onOpenDomain: (domain: string) => void
}

/** Eine der drei Engine-Karten (spec engines/001 §3): Status-Dot, echte Kennzahlen, "open in: <domains>"-Fußzeile. */
export function EngineCard({ tone, title, online, rows, domains, onOpenDomain }: EngineCardProps) {
  return (
    <div className={`engines__card engines__card--${tone}`}>
      <div className="engines__card-head">
        <span className={`engines__dot${online ? ' engines__dot--ok' : ''}`} />
        {title}
      </div>
      <div className="engines__card-rows">
        {rows.map((row) => (
          <div key={row.label} className="engines__card-row">
            <span className="engines__card-row-label">{row.label}</span>
            <span className="engines__card-row-value">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="engines__card-footer">
        {domains.length === 0 ? (
          <span className="engines__card-footer-empty">no domains yet</span>
        ) : (
          <>
            open in:{' '}
            {domains.map((domain, index) => (
              <span key={domain}>
                {index > 0 && ', '}
                <button type="button" className="engines__domain-link" onClick={() => onOpenDomain(domain)}>
                  {domain}
                </button>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
