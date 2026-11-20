import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { BASE_PATH } from '../api'
import { useCapabilities } from '../app/capabilities'
import { endSession } from '../app/queryClient'
import { useConnectedSession } from '../app/session'
import { sseStream } from '../lib/sse'
import { invalidateAllStoreQueries, invalidationTargetsFor, parseStoreEvent } from './storeEvents'

/** Precedent: `INVALIDATE_DEBOUNCE_MS` in the KV watch feed. A resume replay delivers many frames within milliseconds. */
const INVALIDATE_DEBOUNCE_MS = 300

/**
 * Keeps the global lifecycle/DDL stream open and invalidates the explorer queries.
 * No return value, no UI: interval polling still carries the display on its own.
 */
export function useStoreEvents(): void {
  const connected = useConnectedSession()
  const queryClient = useQueryClient()
  const { admin } = useCapabilities()
  const streamClient = admin === 'yes' ? connected?.apiClient : undefined
  // Ref, not state: the counter must not trigger a render.
  const connectCount = useRef(0)

  useEffect(() => {
    if (streamClient === undefined) return
    const controller = new AbortController()

    // One timer for all pending targets: a resume replay delivers up to 1024 frames in a row.
    const pending = new Map<string, QueryKey>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => {
      timer = undefined
      for (const queryKey of pending.values()) void queryClient.invalidateQueries({ queryKey })
      pending.clear()
    }

    void sseStream(`${BASE_PATH}/events`, {
      open: (path, context) => streamClient.openStream(path, { lastEventId: context.lastEventId, silentRecord: context.reconnect }),
      signal: controller.signal,
      onEvent: (frame) => {
        const event = parseStoreEvent(frame)
        if (event === undefined) return
        for (const queryKey of invalidationTargetsFor(event)) pending.set(JSON.stringify(queryKey), queryKey)
        if (pending.size > 0 && timer === undefined) timer = setTimeout(flush, INVALIDATE_DEBOUNCE_MS)
      },
      onReset: () => invalidateAllStoreQueries(queryClient),
      onStateChange: (state) => {
        if (state !== 'connected') return
        connectCount.current += 1
        // The first connect coincides with the mount loads; any later one may have missed events.
        if (connectCount.current > 1) invalidateAllStoreQueries(queryClient)
      },
      onUnauthorized: () => endSession(queryClient),
    })

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [streamClient, queryClient])
}
