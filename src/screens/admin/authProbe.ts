import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH } from '../../api'
import type { Connection } from '../../app/connections'
import { buildTransport } from '../../app/connectionRegistry'
import { getEnvironment } from '../../app/environment'

export const AUTH_ENABLED_PROBE_KEY = ['auth-enabled-probe'] as const

/**
 * `auth.enabled` steht nur in luradb.toml, nicht im REST-Contract — Ableitung über eine einmalige,
 * anonyme Anfrage ohne Authorization-Header (der ApiClient würde ihn immer anhängen, daher direkt
 * über den Transport): 401 (Key verlangt) ⇒ enabled, 200 (offen) ⇒ disabled. staleTime Infinity,
 * weil sich das für die laufende Session nicht ändert.
 */
export function authEnabledProbeQueryOptions(connection: Connection | undefined) {
  return queryOptions({
    queryKey: AUTH_ENABLED_PROBE_KEY,
    queryFn: async (): Promise<boolean> => {
      if (!connection) throw new Error('auth probe requires an active connection')
      const transport = buildTransport(connection.type, getEnvironment())
      const response = await transport.fetchImpl(`${transport.baseUrl}${BASE_PATH}/domains`)
      if (response.status === 401) return true
      if (response.ok) return false
      throw new Error(`unexpected auth probe response (HTTP ${response.status})`)
    },
    enabled: connection !== undefined,
    staleTime: Infinity,
  })
}
