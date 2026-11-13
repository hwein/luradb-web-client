import { formatLatency, formatRate, NUMBER_PLACEHOLDER } from './format'
import type { EngineMetrics, EngineTone } from './metrics'
import { Sparkline } from './Sparkline'

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
  metrics?: EngineMetrics
  spark: number[]
}

/** One read or write line; percentiles only when ops landed in the window (a 0 percentile is no measurement). */
function latencyLine(label: string, ops: number, windowSecs: number, p50: number, p95: number): string {
  const rate = `${label} ${formatRate(ops / windowSecs)}/s`
  return ops === 0 ? rate : `${rate} · p50 ${formatLatency(p50)} · p95 ${formatLatency(p95)}`
}

/** One of the three engine cards: status dot, ops/s and latencies, real figures, "open in: <domains>" footer. */
export function EngineCard({ tone, title, online, rows, domains, onOpenDomain, metrics, spark }: EngineCardProps) {
  return (
    <div className={`engines__card engines__card--${tone}`}>
      <div className="engines__card-head">
        <span className={`engines__dot${online ? ' engines__dot--ok' : ''}`} />
        {title}
        {metrics && <span className="engines__card-window">{metrics.windowSecs}s window</span>}
      </div>
      <div className="engines__card-ops">
        {metrics ? formatRate((metrics.readOps + metrics.writeOps) / metrics.windowSecs) : NUMBER_PLACEHOLDER}
        <span className="engines__card-ops-unit"> ops/s</span>
      </div>
      {metrics && (
        <>
          <div className="engines__card-lat">
            {latencyLine('reads', metrics.readOps, metrics.windowSecs, metrics.readLatencyUsP50, metrics.readLatencyUsP95)}
          </div>
          <div className="engines__card-lat">
            {latencyLine('writes', metrics.writeOps, metrics.windowSecs, metrics.writeLatencyUsP50, metrics.writeLatencyUsP95)}
          </div>
        </>
      )}
      <Sparkline values={spark} />
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
