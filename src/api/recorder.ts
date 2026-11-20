import { useSyncExternalStore } from 'react'
import type { CallInfo } from './client'

export interface RecordedCall extends CallInfo {
  id: string
  ts: number
}

const MAX_ENTRIES = 200

let entries: RecordedCall[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** onCall listener signature; register it with `apiClient.onCall(record)` on the active connection. */
export function record(info: CallInfo): void {
  const entry: RecordedCall = { ...info, id: crypto.randomUUID(), ts: Date.now() }
  const next = [...entries, entry]
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
  notify()
}

/** On connection change, RECENT REQUESTS must not show calls of the previous server. */
export function clearRecordedCalls(): void {
  entries = []
  notify()
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRecordedCalls(): RecordedCall[] {
  return entries
}

/** Last 200 client calls, oldest first; volatile (no storage, no server history). */
export function useRecordedCalls(): RecordedCall[] {
  return useSyncExternalStore(subscribeRecorder, getRecordedCalls)
}
