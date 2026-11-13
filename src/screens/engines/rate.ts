import { useState } from 'react'
import { ENGINE_TONES, type EngineTone, type MetricsSnapshot } from './metrics'

export const SPARKLINE_BARS = 12

type History = Record<EngineTone, number[]>

const EMPTY_HISTORY: History = { kv: [], json: [], rel: [] }

/** Appends a value; keeps the newest `SPARKLINE_BARS` values, oldest dropped first. */
export function appendSample(history: number[], value: number): number[] {
  return [...history, value].slice(-SPARKLINE_BARS)
}

/** One ops/s value per engine and successful fetch; `dataUpdatedAt` triggers it, as an unchanged response keeps its object identity. */
export function useEngineOpsHistory(metrics: MetricsSnapshot | undefined, dataUpdatedAt: number): History {
  const [state, setState] = useState({ at: 0, history: EMPTY_HISTORY })

  if (metrics !== undefined && dataUpdatedAt !== state.at) {
    const history = { ...state.history }
    for (const tone of ENGINE_TONES) {
      const engine = metrics.engines[tone]
      if (engine) history[tone] = appendSample(history[tone], (engine.readOps + engine.writeOps) / engine.windowSecs)
    }
    setState({ at: dataUpdatedAt, history })
  }

  return state.history
}
