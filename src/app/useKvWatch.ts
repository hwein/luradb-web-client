import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BASE_PATH } from '../api'
import { sseStream, type SseCloseReason, type SseConnectionState, type SseEvent } from '../lib/sse'
import { endSession } from './queryClient'
import { useSession } from './session'

const MAX_EVENTS = 500

export interface KvWatchEvent {
  ts: number
  type: 'set' | 'delete'
  key: string
  /** Raw `data:` field of the frame — for the KV watch the key itself (no value). */
  dataRaw: string
}

export interface KvWatchResult {
  events: KvWatchEvent[]
  connectionState: SseConnectionState
  /** Counts the stream's `reset` frames: the server cannot guarantee gap-free delivery, so dependent state must be re-read. */
  resetCount: number
  /** Why the server ended the watch for good; `undefined` while it runs or after a 401. */
  endReason: SseCloseReason | undefined
  /** Clears only the event list, not the connection. */
  clear: () => void
}

function watchPath(domain: string, prefix?: string): string {
  const base = `${BASE_PATH}/kv/${encodeURIComponent(domain)}/watch`
  return prefix ? `${base}?prefix=${encodeURIComponent(prefix)}` : base
}

/**
 * Server format: `event: set|delete`, `data:` = key. Other frames (e.g. pings) yield no event.
 * TTL expiries arrive as `delete` and are not marked separately (the frame carries no reason).
 */
function toKvEvent(frame: SseEvent): KvWatchEvent | undefined {
  if (frame.event !== 'set' && frame.event !== 'delete') return undefined
  return { ts: Date.now(), type: frame.event, key: frame.data, dataRaw: frame.data }
}

/** Opens the KV watch stream for mount/domain/prefix; a change aborts the old stream and starts a new one. */
export function useKvWatch(domain: string, prefix?: string): KvWatchResult {
  const session = useSession()
  const queryClient = useQueryClient()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined

  const [events, setEvents] = useState<KvWatchEvent[]>([])
  const [resetCount, setResetCount] = useState(0)
  const [connectionState, setConnectionState] = useState<SseConnectionState>('closed')
  const [endReason, setEndReason] = useState<SseCloseReason | undefined>(undefined)

  const clear = useCallback(() => setEvents([]), [])

  useEffect(() => {
    if (apiClient === undefined) return
    const controller = new AbortController()
    setEvents([])
    setResetCount(0)
    setEndReason(undefined)

    void sseStream(watchPath(domain, prefix), {
      open: (path, { lastEventId }) => apiClient.openStream(path, { lastEventId }),
      signal: controller.signal,
      onEvent: (frame) => {
        const event = toKvEvent(frame)
        if (event !== undefined) setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
      },
      onReset: () => setResetCount((count) => count + 1),
      onStateChange: setConnectionState,
      onClosed: setEndReason,
      onUnauthorized: () => endSession(queryClient),
    })

    return () => controller.abort()
  }, [apiClient, domain, prefix, queryClient])

  return { events, connectionState, resetCount, endReason, clear }
}
