import { queryOptions, useQuery } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../api'
import { useConnectedSession } from './session'

export type AdminCapability = 'yes' | 'no' | 'pending' | 'error'

export interface Capabilities {
  admin: AdminCapability
  /** Nur gesetzt bei `admin === 'error'` — Text für die Gate-Meldung (spec admin/005 §3). */
  adminError?: string
}

export const ADMIN_PROBE_KEY = ['capabilities', 'admin-probe'] as const

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * queryFn wirft NUR bei echten Fehlern (5xx, Netzfehler) — 401/403 sind ein reguläres "kein Admin"-Ergebnis
 * und geben `false` zurück statt zu werfen, sonst würde ein Retry/isError das Gate fälschlich als Fehler
 * statt als Rollen-Gate zeigen (spec admin/005 §3).
 */
export function adminProbeQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: ADMIN_PROBE_KEY,
    queryFn: async (): Promise<boolean> => {
      if (!apiClient) throw new Error('capabilities probe requires an active connection')
      const { response } = await apiClient.api.GET('/store-api/auth/users')
      if (response.status === 401 || response.status === 403) return false
      if (!response.ok) throw new ApiError(response.status, `unexpected response (HTTP ${response.status})`)
      return true
    },
    enabled: apiClient !== undefined,
  })
}

/**
 * Rechte-Fassade: Screens fragen ausschließlich diesen Hook, nie Rollen-Strings oder Auth-Details.
 * Heutige Ableitung: `GET /auth/users` antwortet nur Admins mit 200 (kein whoami — Backlog server-repo).
 * Vierwertig statt boolesch (spec admin/005 §Entscheidungen): `pending` (lädt, auch ohne Verbindung — die
 * Probe ist dann `enabled: false` und bleibt TanStack-seitig für immer `isPending`) und `error` (Probe
 * scheiterte, kein 401/403) dürfen nie zu "kein Admin" kollabieren.
 * Erweiterungspunkt: feingranulare Rechte je Domäne/Objekt kommen mit dem künftigen
 * Server-Auth-Modell (admin/002, Server-Konzept steht aus) — dann wächst dieses Interface additiv.
 */
export function useCapabilities(): Capabilities {
  const connected = useConnectedSession()
  const query = useQuery(adminProbeQueryOptions(connected?.apiClient))

  if (query.isPending) return { admin: 'pending' }
  if (query.isError) return { admin: 'error', adminError: messageOf(query.error) }
  return { admin: query.data ? 'yes' : 'no' }
}
