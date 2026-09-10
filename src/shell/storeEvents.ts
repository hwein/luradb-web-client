import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { SseEvent } from '../lib/sse'
import { JSON_DOMAINS_KEY, KV_DOMAINS_KEY, REL_DOMAINS_KEY } from './domains'

export interface StoreEvent {
  engine: 'kv' | 'json' | 'rel'
  type: string
  domain: string
  object?: string
  ts: number
}

function isEngine(value: unknown): value is StoreEvent['engine'] {
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
  if (!isEngine(engine) || typeof type !== 'string' || typeof domain !== 'string') return undefined
  return {
    engine,
    type,
    domain,
    ...(typeof object === 'string' ? { object } : {}),
    ts: typeof ts === 'number' ? ts : 0,
  }
}

const DOMAIN_LIST_KEYS: Record<StoreEvent['engine'], QueryKey> = {
  kv: KV_DOMAINS_KEY,
  json: JSON_DOMAINS_KEY,
  rel: REL_DOMAINS_KEY,
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
      return [DOMAIN_LIST_KEYS[event.engine]]
    case 'table_created':
    case 'table_dropped':
      return [['rel-tables', event.domain]]
    case 'view_created':
    case 'view_dropped':
      return [['rel-views', event.domain]]
    case 'index_created':
    case 'index_dropped':
      return event.engine === 'json' ? [['json-indexes', event.domain]] : []
    default:
      return []
  }
}

/** Alle stream-abhängigen Explorer-Queries (spec shell/009 §5) — benannte Liste statt globalem Invalidieren. */
const ALL_STORE_KEYS: QueryKey[] = [KV_DOMAINS_KEY, JSON_DOMAINS_KEY, REL_DOMAINS_KEY, ['rel-tables'], ['rel-views'], ['json-indexes']]

/** Voll-Resync nach `reset` oder Wiederverbindung: was der Stream trägt, wird neu gelesen — sonst nichts. */
export function invalidateAllStoreQueries(queryClient: QueryClient): void {
  for (const queryKey of ALL_STORE_KEYS) void queryClient.invalidateQueries({ queryKey })
}
