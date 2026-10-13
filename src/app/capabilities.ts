import { queryOptions, useQuery } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'
import { authEnabledProbeQueryOptions } from './authProbe'
import { useConnectedSession } from './session'

export type AdminCapability = 'yes' | 'no' | 'pending' | 'error'

export interface Capabilities {
  admin: AdminCapability
  /** Nur gesetzt bei `admin === 'error'` — Text für die Gate-Meldung (spec admin/005 §3). */
  adminError?: string
  /** Nur gesetzt, wenn whoami mit 200 und einem Namen geantwortet hat (spec general/014 §2). */
  identity?: { name: string; role: string }
}

type WhoamiResponse = components['schemas']['WhoamiResponse']

export const WHOAMI_KEY = ['capabilities', 'whoami'] as const

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * queryFn wirft NUR bei echten Fehlern (5xx, 404, Netzfehler) — 401/403 sind ein reguläres "keine Identität"-
 * Ergebnis und geben `null` zurück statt zu werfen, sonst würde ein Retry/isError das Gate fälschlich als
 * Fehler statt als Rollen-Gate zeigen (spec admin/005 §3, general/014 §1).
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
 * Rechte-Fassade: Screens fragen ausschließlich diesen Hook, nie Rollen-Strings oder Auth-Details.
 * Ableitung aus `GET /auth/whoami` (spec general/014): `Admin` und `Disabled` (offener Server) ⇒ yes, jede
 * andere Rolle ⇒ no (least privilege). Nur ein 401/403 fällt auf die anonyme auth.enabled-Probe zurück —
 * im Regelpfad kostet sie keinen Request.
 * Vierwertig statt boolesch (spec admin/005 §Entscheidungen): `pending` (lädt, auch ohne Verbindung — die
 * Query ist dann `enabled: false` und bleibt TanStack-seitig für immer `isPending`) und `error` (Anfrage
 * scheiterte, kein 401/403) dürfen nie zu "kein Admin" kollabieren.
 * Erweiterungspunkt: feingranulare Rechte je Domäne/Objekt kommen mit dem künftigen
 * Server-Auth-Modell (admin/002, Server-Konzept steht aus) — dann wächst dieses Interface additiv.
 */
export function useCapabilities(): Capabilities {
  const connected = useConnectedSession()
  const apiClient = connected?.apiClient
  const whoami = useQuery(whoamiQueryOptions(apiClient))
  const authProbe = useQuery({ ...authEnabledProbeQueryOptions(apiClient), enabled: apiClient !== undefined && whoami.data === null })

  if (whoami.isPending) return { admin: 'pending' }
  if (whoami.isError) return { admin: 'error', adminError: messageOf(whoami.error) }

  if (whoami.data === null) {
    if (authProbe.isPending) return { admin: 'pending' }
    if (authProbe.isError) return { admin: 'error', adminError: messageOf(authProbe.error) }
    return { admin: authProbe.data ? 'no' : 'yes' }
  }

  const { name, role } = whoami.data
  const admin = role === 'Admin' || role === 'Disabled' ? 'yes' : 'no'
  return typeof name === 'string' ? { admin, identity: { name, role } } : { admin }
}
