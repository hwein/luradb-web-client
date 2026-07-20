import { ApiError, type ApiClient } from '../api'

export type Engine = 'kv' | 'json' | 'rel'

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * Ein Aufruf je Engine über Promise.allSettled — ein Fehlschlag bricht die übrigen Engines nicht ab.
 * Jeder Fehlschlag kommt als "<engine>: <message>" zurück (spec shell/003 §1 / admin/001 §3: Teilfehler je Engine).
 */
export async function runEngineCascade(
  engines: Engine[],
  apiClient: ApiClient,
  name: string,
  actions: Record<Engine, (apiClient: ApiClient, name: string) => Promise<void>>,
): Promise<string[]> {
  const attempts = await Promise.allSettled(
    engines.map(async (engine) => {
      try {
        await actions[engine](apiClient, name)
      } catch (error) {
        throw new Error(`${engine}: ${messageOf(error)}`)
      }
    }),
  )
  return attempts
    .filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')
    .map((attempt) => (attempt.reason instanceof Error ? attempt.reason.message : 'request failed'))
}
