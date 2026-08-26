import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH, type ApiClient } from '../../api'

export const AUTH_ENABLED_PROBE_KEY = ['auth-enabled-probe'] as const

/**
 * `auth.enabled` steht nur in luradb.toml, nicht im REST-Contract — Ableitung über eine einmalige,
 * anonyme Anfrage ohne Authorization-Header: 401 (Key verlangt) ⇒ enabled, 200 (offen) ⇒ disabled.
 * Läuft über `apiClient.fetchAnonymous` (derselbe `fetchImpl`/`baseUrl` wie der übrige Client, kein
 * Transport-Aufbau pro Query-Lauf — admin/005 §4). staleTime Infinity, weil sich das für die laufende
 * Session nicht ändert.
 */
export function authEnabledProbeQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: AUTH_ENABLED_PROBE_KEY,
    queryFn: async (): Promise<boolean> => {
      if (!apiClient) throw new Error('auth probe requires an active connection')
      const response = await apiClient.fetchAnonymous(`${BASE_PATH}/domains`)
      if (response.status === 401) return true
      if (response.ok) return false
      throw new Error(`unexpected auth probe response (HTTP ${response.status})`)
    },
    enabled: apiClient !== undefined,
    staleTime: Infinity,
  })
}
