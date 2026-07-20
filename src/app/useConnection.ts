import { useQuery } from '@tanstack/react-query'
import { BASE_PATH } from '../api'
import { healthQueryOptions } from '../screens/engines/health'
import { useCapabilities } from './capabilities'
import { authStatusLabel, connectionHostLabel } from './connectionRegistry'
import { getEnvironment } from './environment'
import { useSession } from './session'

export interface ConnectionInfo {
  state: 'unauthenticated' | 'connecting' | 'connected' | 'error'
  hostLabel: string
  authLabel: string
  serverLabel: string
  uptimeLabel: string
}

/** Minutengenau — feiner löst das 60s-Poll-Intervall ohnehin nicht auf. */
function formatUptime(totalSecs: number): string {
  const days = Math.floor(totalSecs / 86_400)
  const hours = Math.floor((totalSecs % 86_400) / 3_600)
  const minutes = Math.floor((totalSecs % 3_600) / 60)
  if (days > 0) return `up ${days}d ${hours}h`
  if (hours > 0) return `up ${hours}h ${minutes}m`
  return `up ${minutes}m`
}

/** Statusbar-Datenquelle: Werte spiegeln reale Antworten, nie hart verdrahtet. */
export function useConnection(): ConnectionInfo {
  const session = useSession()
  const capabilities = useCapabilities()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined

  // Query-Options geteilt mit dem Engines-Screen (ein Cache-Eintrag); dessen 5s-Intervall gilt nur,
  // solange er subscribed ist — die Statusbar allein pollt alle 60s.
  const health = useQuery({ ...healthQueryOptions(apiClient), refetchInterval: 60_000 })

  if (session.status !== 'connected') {
    return { state: session.status, hostLabel: '', authLabel: '', serverLabel: '', uptimeLabel: '' }
  }

  const env = getEnvironment()
  const hostLabel = `${connectionHostLabel(session.connection.type, env)}${BASE_PATH}`
  const authLabel = authStatusLabel(session.connection.auth, capabilities.admin ? 'admin' : 'user')

  return {
    state: 'connected',
    hostLabel,
    authLabel,
    serverLabel: `luradb ${session.serverVersion}`,
    uptimeLabel: health.data === undefined ? '' : formatUptime(health.data.uptimeSecs),
  }
}
