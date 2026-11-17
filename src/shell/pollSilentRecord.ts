import type { QueryFunctionContext } from '@tanstack/react-query'

/**
 * Erst-Load einer Query bleibt in RECENT REQUESTS sichtbar, automatische Folge-Ticks (Intervall-Poll,
 * Fokus-Refetch) laufen still — erkannt daran, dass der Cache für den Query-Key schon einmal befüllt
 * wurde (general/012 §2, einfachste tragfähige Variante laut Spec).
 */
export function pollSilentRecord(context: Pick<QueryFunctionContext, 'client' | 'queryKey'>): boolean {
  return (context.client.getQueryState(context.queryKey)?.dataUpdatedAt ?? 0) > 0
}
