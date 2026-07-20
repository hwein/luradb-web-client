import { SPARKLINE_BARS } from './rate'

interface SparklineProps {
  /** Werte ältestes zuerst, beliebige Länge — wird auf die letzten 12 zurechtgeschnitten/links aufgefüllt. */
  values: number[]
}

const BAR_HEIGHT_PX = 36
const MIN_BAR_HEIGHT_PX = 2

/** 12-Balken-Sparkline (Prototyp-Stil, spec engines/001 §2/Orchestrator-Hinweis 2): Höhe relativ zum Fenster-Max, Max=0 ⇒ flache Balken. */
export function Sparkline({ values }: SparklineProps) {
  const recent = values.slice(-SPARKLINE_BARS)
  const leadingGap = SPARKLINE_BARS - recent.length
  const padded = Array.from({ length: SPARKLINE_BARS }, (_, i) => recent[i - leadingGap] ?? 0)
  const max = Math.max(0, ...padded)

  return (
    <div className="engines__spark">
      {padded.map((value, index) => {
        const height = max > 0 ? Math.max(MIN_BAR_HEIGHT_PX, Math.round((value / max) * BAR_HEIGHT_PX)) : MIN_BAR_HEIGHT_PX
        return <div key={index} className="engines__spark-bar" style={{ height: `${height}px` }} />
      })}
    </div>
  )
}
