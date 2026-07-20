import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BASE_PATH } from '../api'
import { sseStream, type SseConnectionState, type SseEvent } from '../lib/sse'
import { disconnect, useSession } from './session'

const MAX_EVENTS = 500

export interface KvWatchEvent {
  ts: number
  type: 'set' | 'delete'
  key: string
  /** Rohes `data:`-Feld des Frames — beim KV-Watch der Key selbst (kein Value, siehe general/006). */
  dataRaw: string
}

export interface KvWatchResult {
  events: KvWatchEvent[]
  connectionState: SseConnectionState
  /** Leert nur die Event-Liste, nicht die Verbindung. */
  clear: () => void
}

function watchPath(domain: string, prefix?: string): string {
  const base = `${BASE_PATH}/kv/${encodeURIComponent(domain)}/watch`
  return prefix ? `${base}?prefix=${encodeURIComponent(prefix)}` : base
}

/** Server-Format: `event: set|delete`, `data:` = Key. Andere Frames (z. B. Pings) liefern keinen Event. */
function toKvEvent(frame: SseEvent): KvWatchEvent | undefined {
  if (frame.event !== 'set' && frame.event !== 'delete') return undefined
  return { ts: Date.now(), type: frame.event, key: frame.data, dataRaw: frame.data }
}

/** Öffnet den KV-Watch-Stream für Mount/Domäne/Prefix; Wechsel bricht den alten Stream ab und startet neu. */
export function useKvWatch(domain: string, prefix?: string): KvWatchResult {
  const session = useSession()
  const queryClient = useQueryClient()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined

  const [events, setEvents] = useState<KvWatchEvent[]>([])
  const [connectionState, setConnectionState] = useState<SseConnectionState>('closed')

  const clear = useCallback(() => setEvents([]), [])

  useEffect(() => {
    if (apiClient === undefined) return
    const controller = new AbortController()
    setEvents([])

    void sseStream(watchPath(domain, prefix), {
      open: (path) => apiClient.openStream(path),
      signal: controller.signal,
      onEvent: (frame) => {
        const event = toKvEvent(frame)
        if (event !== undefined) setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
      },
      onStateChange: setConnectionState,
      onUnauthorized: () => {
        disconnect()
        queryClient.clear()
      },
    })

    return () => controller.abort()
  }, [apiClient, domain, prefix, queryClient])

  return { events, connectionState, clear }
}
