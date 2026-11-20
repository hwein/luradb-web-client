import { useSyncExternalStore } from 'react'
import { checkCompatibility, clearRecordedCalls, createApi, record, type ApiClient } from '../api'
import { buildAuthHeader, buildTransport } from './connectionRegistry'
import type { Connection } from './connections'
import { touchLastUsed } from './connections'
import { isCrossOrigin, isMixedContentBlocked } from './crossOrigin'
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
// The recorder is a module singleton bound to exactly one ApiClient; on a connection change detach the old
// listener first, or a replaced client would keep recording.
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

export interface ConnectedSession {
  apiClient: ApiClient
  serverVersion: string
  connectionId: string
}

/** Condensed view for consumers that are only active when connected — saves the `status === 'connected'` narrowing at every call site. */
export function useConnectedSession(): ConnectedSession | undefined {
  const session = useSession()
  if (session.status !== 'connected') return undefined
  return { apiClient: session.apiClient, serverVersion: session.serverVersion, connectionId: session.connection.id }
}

/** Version handshake: 401 ⇒ invalid key, network error ⇒ unreachable, otherwise compat check. */
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

  if (env === 'browser' && isMixedContentBlocked(window.location.href, transport.baseUrl)) {
    const host = new URL(transport.baseUrl).host
    setState({
      status: 'error',
      connection,
      message: `blocked by the browser: this page is served over https and cannot call the http api at ${host} (mixed content) — use an https server url, or leave the url empty to go through this origin’s proxy`,
    })
    return
  }

  // Only the fetch itself counts as "unreachable" — a later error in checkCompatibility/touchLastUsed
  // is no reachability problem and must not be masked as one.
  let failureDetail: string | undefined
  const probe = await apiClient.api.GET('/version').catch((error: unknown) => {
    // Show the original error text (e.g. a Tauri scope denial) instead of hiding it behind "unreachable".
    if (error instanceof Error && error.message !== 'server unreachable') {
      failureDetail = error.message.replace(/^server unreachable — /, '')
    }
    return undefined
  })
  if (probe === undefined) {
    const suffix = failureDetail === undefined ? '' : ` — ${failureDetail}`
    // Heuristic: a TLS handshake failure is indistinguishable from "server down" in the fetch exception text,
    // so the hint appears for every unreachable https:// target without the flag set.
    const certHint =
      env === 'desktop' && connection.type.url.startsWith('https://') && connection.type.acceptInvalidCerts !== true
        ? ' — if this server uses a self-signed certificate, enable "Accept self-signed certificates" in the connection settings'
        : ''
    // Same pattern for CORS: a blocked cross-origin request is indistinguishable from a server that is down.
    const corsHint =
      env === 'browser' && isCrossOrigin(window.location.origin, transport.baseUrl)
        ? ' — cross-origin request: this also fails when the server does not allow this origin in its [cors] section; a blocked request looks exactly like an unreachable server'
        : ''
    setState({ status: 'error', connection, message: `server unreachable at ${transport.baseUrl}${suffix}${certHint}${corsHint}` })
    return
  }

  const { data, response } = probe
  if (response.status === 401) {
    setState({ status: 'error', connection, message: 'invalid api key' })
    return
  }
  // The same-origin proxy (browser mode) reports an unreachable backend as a gateway status, not as a
  // fetch exception — so 502/503/504 also count as "unreachable".
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

/** Back to the gate. Does not clear the query cache; the caller does (it holds the QueryClient). */
export function disconnect(): void {
  unsubscribeRecorder?.()
  unsubscribeRecorder = undefined
  clearRecordedCalls()
  setState({ status: 'unauthenticated' })
}
