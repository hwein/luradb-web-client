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
 * Eigene Komponente, nur gemountet wenn der Watch-Toggle aktiv ist (spec §4) — so läuft `useKvWatch` bei Mount,
 * ohne den Hook im Elternteil bedingt aufzurufen. Events invalidieren die Key-Liste debounced (ein Timer, ~300ms).
 */
export function KvWatchFeed({ domain, prefix }: KvWatchFeedProps) {
  const queryClient = useQueryClient()
  const { events, connectionState } = useKvWatch(domain, prefix)

  // 410 (Domäne wird gelöscht) beendet den Stream endgültig mit `closed` — dieselbe `closed`-State ist aber auch der
  // initiale Default vor dem ersten Verbindungsversuch. Nur nach mindestens einem 'connected'/'reconnecting' zählt
  // ein Rücksprung auf 'closed' als "vom Server beendet", sonst würde jeder Toggle-Start kurz die Hinweiszeile zeigen.
  const [everConnected, setEverConnected] = useState(false)
  useEffect(() => {
    if (connectionState === 'connected' || connectionState === 'reconnecting') setEverConnected(true)
  }, [connectionState])
  const endedByServer = everConnected && connectionState === 'closed'

  const latestTs = events[0]?.ts
  useEffect(() => {
    if (latestTs === undefined) return
    const timer = setTimeout(() => {
      invalidateKvKeys(queryClient, domain)
    }, INVALIDATE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [latestTs, domain, queryClient])

  return (
    <div className="kv-feed">
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
