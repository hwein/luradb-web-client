import { useQuery } from '@tanstack/react-query'
import { BASE_PATH } from '../api'
import { healthQueryOptions, type HealthSnapshot } from '../screens/engines/health'
import { useCapabilities } from './capabilities'
import { authStatusLabel, connectionHostLabel } from './connectionRegistry'
import { getEnvironment } from './environment'
import { useSession } from './session'

export interface ConnectionInfo {
  state: 'unauthenticated' | 'connecting' | 'connected' | 'error'
  hostLabel: string
  authLabel: string
  signedInLabel: string
  serverLabel: string
  uptimeLabel: string
  healthLabel: string
  healthBlocked: boolean
}

function healthReasons(health: HealthSnapshot): string[] {
  const { resources } = health
  const reasons = health.shards.filter((shard) => shard.status !== 'ok').map((shard) => `shard ${shard.id} ${shard.status}`)
  if (resources.diskState === 'warning') reasons.push('disk space low')
  if (resources.diskState === 'blocked') reasons.push('writes blocked: disk')
  if (resources.memoryState === 'warning') reasons.push('memory low')
  if (resources.memoryState === 'blocked') reasons.push('writes blocked: memory')
  if (health.ioFailures > 0) reasons.push(`i/o failures: ${health.ioFailures}`)
  return reasons
}

function healthLabelOf(health: HealthSnapshot | undefined): string {
  if (health === undefined || health.status === 'ok') return ''
  return ['degraded', ...healthReasons(health)].join(' · ')
}

function isHealthBlocked(health: HealthSnapshot | undefined): boolean {
  if (health === undefined || health.status === 'ok') return false
  const { resources } = health
  return resources.diskState === 'blocked' || resources.memoryState === 'blocked' || health.shards.some((shard) => shard.status !== 'ok')
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
    return { state: session.status, hostLabel: '', authLabel: '', signedInLabel: '', serverLabel: '', uptimeLabel: '', healthLabel: '', healthBlocked: false }
  }

  const env = getEnvironment()
  const hostLabel = `${connectionHostLabel(session.connection.type, env)}${BASE_PATH}`
  // pending/error: Rolle noch nicht bekannt — leeres Label statt eines geratenen "user" (spec admin/005 §Entscheidungen).
  const roleLabel = capabilities.admin === 'yes' ? 'admin' : capabilities.admin === 'no' ? 'user' : undefined
  const authLabel = roleLabel === undefined ? '' : authStatusLabel(session.connection.auth, roleLabel)

  return {
    state: 'connected',
    hostLabel,
    authLabel,
    signedInLabel: capabilities.identity === undefined ? '' : `signed in as ${capabilities.identity.name}`,
    serverLabel: `luradb ${session.serverVersion}`,
    uptimeLabel: health.data === undefined ? '' : formatUptime(health.data.uptimeSecs),
    healthLabel: healthLabelOf(health.data),
    healthBlocked: isHealthBlocked(health.data),
  }
}
