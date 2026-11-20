import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useKvWatch } from '../../app/useKvWatch'
import { invalidateKvKeys } from './kvEntries'

const INVALIDATE_DEBOUNCE_MS = 300

interface KvWatchFeedProps {
  domain: string
  prefix: string
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Separate component, mounted only while the watch toggle is on, so `useKvWatch` runs on mount
 * without calling the hook conditionally in the parent. Events invalidate the key list debounced (one timer, ~300ms).
 */
export function KvWatchFeed({ domain, prefix }: KvWatchFeedProps) {
  const queryClient = useQueryClient()
  const { events, connectionState, resetCount } = useKvWatch(domain, prefix)

  // 410 (domain being deleted) ends the stream for good with `closed`, but `closed` is also the
  // initial default before the first connection attempt. Only after at least one 'connected'/'reconnecting' does
  // a fall back to 'closed' count as "ended by the server", else every toggle start would briefly show the hint line.
  const [everConnected, setEverConnected] = useState(false)
  useEffect(() => {
    if (connectionState === 'connected' || connectionState === 'reconnecting') setEverConnected(true)
  }, [connectionState])
  const endedByServer = everConnected && connectionState === 'closed'

  // A `reset` means "no gap-free guarantee": same invalidation as after an event, without its own display.
  const latestTs = events[0]?.ts
  useEffect(() => {
    if (latestTs === undefined && resetCount === 0) return
    const timer = setTimeout(() => {
      invalidateKvKeys(queryClient, domain)
    }, INVALIDATE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [latestTs, resetCount, domain, queryClient])

  return (
    <div className="kv-feed selectable">
      <div className="kv-feed__head">
        <span className="mono-label">WATCH</span>
        <span className="kv-feed__state">
          {connectionState === 'connected' ? 'live' : connectionState === 'reconnecting' ? 'reconnecting…' : ''}
        </span>
      </div>
      {events.length === 0 && !endedByServer && <div className="kv-feed__hint">waiting for events…</div>}
      {events.map((event, index) => (
        <div key={index} className="kv-feed__row">
          <span className="kv-feed__time">{formatTime(event.ts)}</span>
          <span className={`kv-feed__type kv-feed__type--${event.type}`}>{event.type}</span>
          <span className="kv-feed__key">{event.key}</span>
        </div>
      ))}
      {endedByServer && <div className="kv-feed__ended">domain is being deleted — watch ended</div>}
    </div>
  )
}
