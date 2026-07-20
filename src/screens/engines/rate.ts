export interface Totals {
  totalReads: number
  totalWrites: number
}

export interface RateSample {
  ts: number
  readsPerSec: number
  writesPerSec: number
}

export const MAX_SAMPLES = 60
export const SPARKLINE_BARS = 12

/**
 * Durchsatz aus zwei Metrik-Ständen (spec engines/001 §1/§2). Ein Counter-Reset (Server-Neustart:
 * `next` < `prev`) liefert `undefined` statt einer negativen Rate — der Aufrufer verwirft das Sample.
 */
export function sampleRate(prev: Totals, next: Totals, elapsedMs: number): { readsPerSec: number; writesPerSec: number } | undefined {
  if (elapsedMs <= 0) return undefined
  if (next.totalReads < prev.totalReads || next.totalWrites < prev.totalWrites) return undefined

  const elapsedSec = elapsedMs / 1000
  return {
    readsPerSec: (next.totalReads - prev.totalReads) / elapsedSec,
    writesPerSec: (next.totalWrites - prev.totalWrites) / elapsedSec,
  }
}

/** Hängt ein Sample an; hält die Historie auf max. 60 Einträge (älteste zuerst verworfen). */
export function appendSample(history: RateSample[], sample: RateSample): RateSample[] {
  const next = [...history, sample]
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next
}
