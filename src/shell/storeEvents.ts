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

/** Best effort: jeder Frame, der nicht als Store-Event lesbar ist, ergibt `undefined` — nie ein Wurf, nie eine Meldung. */
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
 * Abbildung aus spec shell/009 §2. Unbekannte Typen invalidieren nichts (kein Sammel-Fallback), ebenso
 * `index_*` mit `engine: 'rel'`: der Explorer listet keine rel-Indexe. Dokument-/Key-Bestand trägt weiter das Intervall.
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

/** Alle stream-abhängigen Explorer-Queries (spec shell/009 §5) — benannte Liste statt globalem Invalidieren. */
const ALL_STORE_KEYS: QueryKey[] = [DOMAINS_KEY, REL_TABLES_PREFIX, REL_VIEWS_PREFIX, JSON_INDEXES_PREFIX]

/** Voll-Resync nach `reset` oder Wiederverbindung: was der Stream trägt, wird neu gelesen — sonst nichts. */
export function invalidateAllStoreQueries(queryClient: QueryClient): void {
  for (const queryKey of ALL_STORE_KEYS) void queryClient.invalidateQueries({ queryKey })
}
