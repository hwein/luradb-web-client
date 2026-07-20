import { useEffect, useRef, useState } from 'react'
import { formatNumber } from './format'
import type { MetricsSnapshot } from './metrics'
import { appendSample, sampleRate, type RateSample, type Totals } from './rate'
import { Sparkline } from './Sparkline'

interface SystemThroughputProps {
  metrics: MetricsSnapshot | undefined
}

/**
 * SYSTEM-Durchsatzleiste (spec engines/001 §2): reads/s und writes/s aus der Client-seitigen
 * Sample-Historie der `/store-api/metrics`-Deltas. Abweichung vom Fixture (ops/s + p99 je Engine):
 * die API liefert das nicht pro Engine — dokumentiert im Abschlussbericht.
 */
export function SystemThroughput({ metrics }: SystemThroughputProps) {
  const [history, setHistory] = useState<RateSample[]>([])
  const prevRef = useRef<{ totals: Totals; ts: number } | undefined>(undefined)

  useEffect(() => {
    const system = metrics?.system
    if (system === undefined) return
    const now = Date.now()
    const totals: Totals = { totalReads: system.totalReads, totalWrites: system.totalWrites }
    const prev = prevRef.current
    if (prev !== undefined) {
      const rate = sampleRate(prev.totals, totals, now - prev.ts)
      if (rate !== undefined) setHistory((current) => appendSample(current, { ts: now, ...rate }))
    }
    prevRef.current = { totals, ts: now }
  }, [metrics])

  const latest = history[history.length - 1]

  return (
    <div className="engines__throughput">
      <div className="engines__throughput-stat">
        <div className="engines__throughput-value">
          {formatNumber(latest?.readsPerSec ?? 0)}
          <span className="engines__throughput-unit"> reads/s</span>
        </div>
        <Sparkline values={history.map((sample) => sample.readsPerSec)} />
      </div>
      <div className="engines__throughput-stat">
        <div className="engines__throughput-value">
          {formatNumber(latest?.writesPerSec ?? 0)}
          <span className="engines__throughput-unit"> writes/s</span>
        </div>
        <Sparkline values={history.map((sample) => sample.writesPerSec)} />
      </div>
      <div className="engines__throughput-label">system-wide · derived from /store-api/metrics</div>
    </div>
  )
}
