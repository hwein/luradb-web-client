import { setupServer } from 'msw/node'
import type { components } from '../api/schema'

export const server = setupServer()

type KeyScanResponse = components['schemas']['KeyScanResponse']
type DomainResponse = components['schemas']['DomainResponse']

/** An active domain as `GET /store-api/domains` lists it (Contract 0.17.0), with every required field. */
export function domainResponse(name: string, overrides?: Partial<DomainResponse>): DomainResponse {
  return { name, created_at: 1, state: 'active', require_conditional_writes: { kv: false, json: false }, ...overrides }
}

/** Envelope von `GET /store-api/kv/{domain}/keys` (Contract 0.6.1) — Tests nennen nur die Keys; `total`/`offset`/`limit` sind überschreibbar (Paging-Tests). */
export function kvKeyScan(keys: string[], envelope: Partial<Omit<KeyScanResponse, 'keys'>> = {}): KeyScanResponse {
  return { keys, total: keys.length, offset: 0, limit: 10000, ...envelope }
}
