import { useSyncExternalStore } from 'react'

export interface DocsState {
  /** Offene Tabs (Artikel-Ids), in Öffnungsreihenfolge. */
  tabs: string[]
  activeId: string | undefined
  search: string
}

const initialState: DocsState = { tabs: [], activeId: undefined, search: '' }

let state: DocsState = initialState
const listeners = new Set<() => void>()

function setState(next: DocsState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): DocsState {
  return state
}

/** Tab-/Suchzustand des Docs-Screens — Modul-Store statt useState, weil der Screen bei Routenwechsel unmountet. */
export function useDocsState(): DocsState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Öffnet den Artikel-Tab (falls noch nicht offen) und aktiviert ihn. */
export function openArticle(id: string): void {
  const tabs = state.tabs.includes(id) ? state.tabs : [...state.tabs, id]
  setState({ ...state, tabs, activeId: id })
}

export function activateTab(id: string): void {
  if (!state.tabs.includes(id)) return
  setState({ ...state, activeId: id })
}

/** War der geschlossene Tab aktiv, übernimmt der linke Nachbar (sonst der neue erste Tab). */
export function closeTab(id: string): void {
  const index = state.tabs.indexOf(id)
  if (index === -1) return
  const tabs = state.tabs.filter((tabId) => tabId !== id)
  const activeId = state.activeId === id ? tabs[Math.max(0, index - 1)] : state.activeId
  setState({ ...state, tabs, activeId })
}

export function setSearch(query: string): void {
  setState({ ...state, search: query })
}

/** Nur für Tests. */
export function resetDocsState(): void {
  setState(initialState)
}
