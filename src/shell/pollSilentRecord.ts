import type { QueryFunctionContext } from '@tanstack/react-query'

/**
 * A query's first load stays visible in RECENT REQUESTS, automatic follow-up ticks (interval poll,
 * focus refetch) run silently; detected by the cache having been filled for the query key before
 * (the simplest workable variant).
 */
export function pollSilentRecord(context: Pick<QueryFunctionContext, 'client' | 'queryKey'>): boolean {
  return (context.client.getQueryState(context.queryKey)?.dataUpdatedAt ?? 0) > 0
}
