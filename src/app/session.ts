import { useSyncExternalStore } from 'react'
import { checkCompatibility, createApi, record, type ApiClient } from '../api'
import { buildAuthHeader, buildTransport } from './connectionRegistry'
import type { Connection } from './connections'
import { touchLastUsed } from './connections'
import { getEnvironment } from './environment'

export type SessionState =
  | { status: 'unauthenticated' }
  | { status: 'connecting'; connection: Connection }
  | {
      status: 'connected'
      connection: Connection
      apiClient: ApiClient
      serverVersion: string
      apiVersion: string
      compatibilityWarning?: string
    }
  | { status: 'error'; connection: Connection; message: string }

let state: SessionState = { status: 'unauthenticated' }
const listeners = new Set<() => void>()
// Recorder ist ein Modul-Singleton (general/005) — hängt an genau einem ApiClient; bei Verbindungswechsel
// erst den alten Listener lösen, sonst würde ein abgelöster Client weiter mitprotokollieren.
let unsubscribeRecorder: (() => void) | undefined

function setState(next: SessionState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): SessionState {
  return state
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Version-Handshake gemäß api/COMPATIBILITY.md: 401 ⇒ ungültiger Key, Netzwerkfehler ⇒ unreachable, sonst Compat-Check. */
export async function connect(connection: Connection): Promise<void> {
  setState({ status: 'connecting', connection })

  unsubscribeRecorder?.()
  const env = getEnvironment()
  const transport = buildTransport(connection.type, env)
  const authHeader = buildAuthHeader(connection.auth)
  const apiClient = createApi({
    baseUrl: transport.baseUrl,
    fetchImpl: transport.fetchImpl,
    getAuthHeader: () => authHeader,
  })
  unsubscribeRecorder = apiClient.onCall(record)

  // Nur der Fetch selbst zählt als "unreachable" — ein Fehler in checkCompatibility/touchLastUsed danach
  // wäre kein Erreichbarkeits-Problem und soll nicht als solches maskiert werden.
  let failureDetail: string | undefined
  const probe = await apiClient.api.GET('/version').catch((error: unknown) => {
    // Original-Fehlertext sichtbar machen (z. B. Tauri-Scope-Denial) statt ihn hinter "unreachable" zu verstecken.
    if (error instanceof Error && error.message !== 'server unreachable') {
      failureDetail = error.message.replace(/^server unreachable — /, '')
    }
    return undefined
  })
  if (probe === undefined) {
    const suffix = failureDetail === undefined ? '' : ` — ${failureDetail}`
    // Heuristik: ein TLS-Handshake-Fehler ist im Fetch-Exception-Text nicht von "Server aus" zu unterscheiden
    // (spec 009) — der Hinweis erscheint deshalb bei jedem unreachable https://-Ziel ohne gesetztes Flag.
    const certHint =
      env === 'desktop' && connection.type.url.startsWith('https://') && connection.type.acceptInvalidCerts !== true
        ? ' — if this server uses a self-signed certificate, enable "Accept self-signed certificates" in the connection settings'
        : ''
    setState({ status: 'error', connection, message: `server unreachable at ${transport.baseUrl}${suffix}${certHint}` })
    return
  }

  const { data, response } = probe
  if (response.status === 401) {
    setState({ status: 'error', connection, message: 'invalid api key' })
    return
  }
  // Same-origin-Proxy (Browser-Modus) meldet ein nicht erreichbares Backend als Gateway-Status,
  // nicht als Fetch-Exception — 502/503/504 zählen deshalb ebenfalls als "unreachable".
  if ([502, 503, 504].includes(response.status)) {
    setState({ status: 'error', connection, message: `server unreachable at ${transport.baseUrl}` })
    return
  }
  if (!response.ok || !data) {
    setState({ status: 'error', connection, message: `unexpected response from server (HTTP ${response.status})` })
    return
  }

  const compatibility = checkCompatibility(data)
  if (!compatibility.compatible) {
    setState({ status: 'error', connection, message: compatibility.reason ?? 'incompatible server version' })
    return
  }

  touchLastUsed(connection.id)
  setState({
    status: 'connected',
    connection: { ...connection, lastUsed: Date.now() },
    apiClient,
    serverVersion: data.server_version,
    apiVersion: data.api_version,
    compatibilityWarning: compatibility.reason,
  })
}

/** Zurück ins Gate. Räumt keinen Query-Cache auf — das obliegt dem Aufrufer (hat den QueryClient). */
export function disconnect(): void {
  unsubscribeRecorder?.()
  unsubscribeRecorder = undefined
  setState({ status: 'unauthenticated' })
}
