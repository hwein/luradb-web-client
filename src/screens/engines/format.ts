import { formatNumber } from '../../lib'

export const NUMBER_PLACEHOLDER = '…'

export function formatRate(perSec: number): string {
  if (perSec === 0) return '0'
  return perSec < 10 ? perSec.toFixed(1) : formatNumber(perSec)
}

/** `us` is in µs, as the server reports it. */
export function formatLatency(us: number): string {
  return us < 1000 ? `${us} µs` : `${(us / 1000).toFixed(1)} ms`
}
