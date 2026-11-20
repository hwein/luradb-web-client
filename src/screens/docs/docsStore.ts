import { useSyncExternalStore } from 'react'
import { resolveSitePage } from './articles/articles'

export interface DocsState {
  /** Open tabs (topic ids or site paths), in opening order. */
  tabs: string[]
  activeId: string | undefined
  search: string
  /** Anchor per tab id. */
  anchors: Record<string, string>
}

const initialState: DocsState = { tabs: [], activeId: undefined, search: '', anchors: {} }

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

/** Tab and search state of the docs screen; a module store because the screen unmounts on route changes. */
export function useDocsState(): DocsState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

function withoutAnchor(anchors: Record<string, string>, id: string): Record<string, string> {
  const next = { ...anchors }
  delete next[id]
  return next
}

/** Opens the tab (if not open yet) and activates it; without `anchor` the tab takes the anchor of its topic. */
export function openArticle(id: string, anchor?: string): void {
  const tabs = state.tabs.includes(id) ? state.tabs : [...state.tabs, id]
  const anchors = withoutAnchor(state.anchors, id)
  const target = anchor ?? resolveSitePage(id)?.anchor
  setState({ ...state, tabs, activeId: id, anchors: target === undefined ? anchors : { ...anchors, [id]: target } })
}

export function activateTab(id: string): void {
  if (!state.tabs.includes(id)) return
  setState({ ...state, activeId: id })
}

/** If the closed tab was active, its left neighbour takes over (else the new first tab). */
export function closeTab(id: string): void {
  const index = state.tabs.indexOf(id)
  if (index === -1) return
  const tabs = state.tabs.filter((tabId) => tabId !== id)
  const activeId = state.activeId === id ? tabs[Math.max(0, index - 1)] : state.activeId
  setState({ ...state, tabs, activeId, anchors: withoutAnchor(state.anchors, id) })
}

export function setSearch(query: string): void {
  setState({ ...state, search: query })
}

/** Tests only. */
export function resetDocsState(): void {
  setState(initialState)
}
