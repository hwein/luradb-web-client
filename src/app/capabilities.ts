import { queryOptions, useQuery } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'
import { useConnectedSession } from './session'

export type AdminCapability = 'yes' | 'no' | 'pending' | 'error'

export interface Capabilities {
  admin: AdminCapability
  /** Only set when `admin === 'error'` — text for the gate message. */
  adminError?: string
  /** Only set when whoami answered 200 with a name. */
  identity?: { name: string; role: string }
}

type WhoamiResponse = components['schemas']['WhoamiResponse']

export const WHOAMI_KEY = ['capabilities', 'whoami'] as const

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * queryFn throws ONLY on real errors (5xx, 404, network); 401/403 is a regular "no identity" result and
 * returns `null`, otherwise a retry/isError would show the gate as an error instead of a role gate.
 */
export function whoamiQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: WHOAMI_KEY,
    queryFn: async (): Promise<WhoamiResponse | null> => {
      if (!apiClient) throw new Error('capabilities probe requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/auth/whoami')
      if (response.status === 401 || response.status === 403) return null
      if (!response.ok || data === undefined) throw new ApiError(response.status, `unexpected response (HTTP ${response.status})`)
      return data
    },
    enabled: apiClient !== undefined,
    staleTime: Infinity,
  })
}

/**
 * Permissions facade: screens ask only this hook, never role strings or auth details.
 * Derived from `GET /auth/whoami`: `Admin` and `Disabled` (open server) ⇒ yes, any other role and 401/403 ⇒ no
 * (least privilege).
 * Four-valued, not boolean: `pending` (loading, also without a connection — the query is then `enabled: false`
 * and stays `isPending` forever) and `error` (request failed, not 401/403) must never collapse to "not admin".
 * Extension point: per-domain/object permissions will extend this interface additively.
 */
export function useCapabilities(): Capabilities {
  const connected = useConnectedSession()
  const apiClient = connected?.apiClient
  const whoami = useQuery(whoamiQueryOptions(apiClient))

  if (whoami.isPending) return { admin: 'pending' }
  if (whoami.isError) return { admin: 'error', adminError: messageOf(whoami.error) }
  if (whoami.data === null) return { admin: 'no' }

  const { name, role } = whoami.data
  const admin = role === 'Admin' || role === 'Disabled' ? 'yes' : 'no'
  return typeof name === 'string' ? { admin, identity: { name, role } } : { admin }
}
