import { setupServer } from 'msw/node'
import type { components } from '../api/schema'

export const server = setupServer()

/** Envelope von `GET /store-api/kv/{domain}/keys` (Contract 0.6.1) — Tests nennen nur die Keys. */
export function kvKeyScan(keys: string[]): components['schemas']['KeyScanResponse'] {
  return { keys, total: keys.length, offset: 0, limit: 10000 }
}
