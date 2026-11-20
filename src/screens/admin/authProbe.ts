import { queryOptions } from '@tanstack/react-query'
import { BASE_PATH, type ApiClient } from '../../api'

export const AUTH_ENABLED_PROBE_KEY = ['auth-enabled-probe'] as const

/**
 * `auth.enabled` lives only in luradb.toml; the REST contract shows it only indirectly (whoami role `Disabled`),
 * so the AUTH card derives it from a one-off anonymous request without an Authorization header:
 * 401 (key required) means enabled, 200 (open) means disabled.
 * Goes through `apiClient.fetchAnonymous` (same `fetchImpl`/`baseUrl` as the rest of the client, no
 * transport setup per query run). staleTime Infinity because this does not change for the running
 * session.
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
