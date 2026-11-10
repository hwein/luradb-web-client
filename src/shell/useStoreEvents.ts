import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { BASE_PATH } from '../api'
import { useCapabilities } from '../app/capabilities'
import { disconnect, useConnectedSession } from '../app/session'
import { sseStream } from '../lib/sse'
import { invalidateAllStoreQueries, invalidationTargetsFor, parseStoreEvent } from './storeEvents'

/** Precedent: `INVALIDATE_DEBOUNCE_MS` in the KV watch feed. A resume replay delivers many frames within milliseconds. */
const INVALIDATE_DEBOUNCE_MS = 300

/**
 * Hält den globalen Lifecycle-/DDL-Stream (spec shell/009) offen und invalidiert die Explorer-Queries.
 * Kein Rückgabewert, kein UI: das Intervall-Polling aus shell/007 trägt die Anzeige weiterhin allein.
 */
export function useStoreEvents(): void {
  const connected = useConnectedSession()
  const queryClient = useQueryClient()
  const { admin } = useCapabilities()
  const streamClient = admin === 'yes' ? connected?.apiClient : undefined
  // Ref statt State: der Zähler darf kein Rendering auslösen.
  const connectCount = useRef(0)

  useEffect(() => {
    if (streamClient === undefined) return
    const controller = new AbortController()

    // Ein Timer für alle offenen Ziele: ein Resume-Replay liefert bis zu 1024 Frames am Stück.
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
        // Der erste Verbindungsaufbau fällt mit den Mount-Ladevorgängen zusammen; jeder spätere kann eine Lücke gehabt haben.
        if (connectCount.current > 1) invalidateAllStoreQueries(queryClient)
      },
      onUnauthorized: () => {
        disconnect()
        queryClient.clear()
      },
    })

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [streamClient, queryClient])
}
