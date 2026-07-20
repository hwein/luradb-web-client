import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../api'
import { useSession } from './session'

export interface Capabilities {
  admin: boolean
}

/**
 * Rechte-Fassade: Screens fragen ausschließlich diesen Hook, nie Rollen-Strings oder Auth-Details.
 * Heutige Ableitung: `GET /auth/users` antwortet nur Admins mit 200 (kein whoami — Backlog server-repo).
 * Erweiterungspunkt: feingranulare Rechte je Domäne/Objekt kommen mit dem künftigen
 * Server-Auth-Modell (admin/002, Server-Konzept steht aus) — dann wächst dieses Interface additiv.
 */
export function useCapabilities(): Capabilities {
  const session = useSession()
  const connected = session.status === 'connected'

  const { data } = useQuery({
    queryKey: ['capabilities', 'admin-probe'],
    queryFn: async () => {
      if (session.status !== 'connected') throw new Error('capabilities probe requires an active connection')
      const { response } = await session.apiClient.api.GET('/store-api/auth/users')
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      return response.ok
    },
    enabled: connected,
  })

  return { admin: data ?? false }
}
