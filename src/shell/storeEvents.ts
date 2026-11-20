import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { SseEvent } from '../lib/sse'
import { JSON_INDEXES_PREFIX, jsonIndexesKey, REL_TABLES_PREFIX, REL_VIEWS_PREFIX, relTablesKey, relViewsKey } from './domainDetails'
import { DOMAINS_KEY } from './domains'

export interface StoreEvent {
  /** Missing on domain events — they concern the domain in all engines. */
  engine?: 'kv' | 'json' | 'rel'
  type: string
  domain: string
  object?: string
  ts: number
}

function isEngine(value: unknown): value is NonNullable<StoreEvent['engine']> {
  return value === 'kv' || value === 'json' || value === 'rel'
}

/** Best effort: any frame that is not readable as a store event yields `undefined`; never a throw, never a message. */
export function parseStoreEvent(frame: SseEvent): StoreEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(frame.data)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { engine, type, domain, object, ts } = parsed as Record<string, unknown>
  if ((engine !== undefined && !isEngine(engine)) || typeof type !== 'string' || typeof domain !== 'string') return undefined
  return {
    ...(engine === undefined ? {} : { engine }),
    type,
    domain,
    ...(typeof object === 'string' ? { object } : {}),
    ts: typeof ts === 'number' ? ts : 0,
  }
}

/**
 * Event type to query keys. Unknown types invalidate nothing (no catch-all fallback), nor does
 * `index_*` with `engine: 'rel'`: the explorer lists no rel indexes. Document/key counts still ride on the interval.
 */
export function invalidationTargetsFor(event: StoreEvent): QueryKey[] {
  switch (event.type) {
    case 'domain_created':
    case 'domain_deleted':
    case 'domain_purged':
      return [DOMAINS_KEY]
    case 'table_created':
    case 'table_dropped':
      return [relTablesKey(event.domain)]
    case 'view_created':
    case 'view_dropped':
      return [relViewsKey(event.domain)]
    case 'index_created':
    case 'index_dropped':
      return event.engine === 'json' ? [jsonIndexesKey(event.domain)] : []
    default:
      return []
  }
}

/** All stream-dependent explorer queries: a named list instead of invalidating globally. */
const ALL_STORE_KEYS: QueryKey[] = [DOMAINS_KEY, REL_TABLES_PREFIX, REL_VIEWS_PREFIX, JSON_INDEXES_PREFIX]

/** Full resync after `reset` or a reconnect: what the stream carries is re-read, nothing else. */
export function invalidateAllStoreQueries(queryClient: QueryClient): void {
  for (const queryKey of ALL_STORE_KEYS) void queryClient.invalidateQueries({ queryKey })
}
