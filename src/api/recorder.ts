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

/** onCall-Listener-Signatur — mit `apiClient.onCall(record)` an der aktiven Verbindung registrieren. */
export function record(info: CallInfo): void {
  const entry: RecordedCall = { ...info, id: crypto.randomUUID(), ts: Date.now() }
  const next = [...entries, entry]
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
  notify()
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRecordedCalls(): RecordedCall[] {
  return entries
}

/** Letzte 200 Client-Calls, älteste zuerst; flüchtig (kein Storage, keine Server-Historie). */
export function useRecordedCalls(): RecordedCall[] {
  return useSyncExternalStore(subscribeRecorder, getRecordedCalls)
}
