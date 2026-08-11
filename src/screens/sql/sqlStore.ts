import { useSyncExternalStore } from 'react'

export interface SqlTab {
  id: string
  name: string
  text: string
  expand: string[]
  /** Rohtext des params-Felds (auch ungültiges JSON übersteht so einen Tab-Wechsel, spec sql/003 §3). */
  params: string
}

interface SqlState {
  tabs: SqlTab[]
  activeId: string
}

const STORAGE_KEY = 'luradb.sqlTabs'

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function nextUntitledName(tabs: SqlTab[]): string {
  const taken = new Set(tabs.map((tab) => tab.name))
  let index = 1
  while (taken.has(`untitled-${index}.sql`)) index += 1
  return `untitled-${index}.sql`
}

function defaultState(): SqlState {
  const tab: SqlTab = { id: makeId(), name: 'untitled-1.sql', text: '', expand: [], params: '' }
  return { tabs: [tab], activeId: tab.id }
}

function sanitizeExpand(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function sanitizeTabs(value: unknown): SqlTab[] {
  if (!Array.isArray(value)) return []
  const tabs: SqlTab[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    if (typeof record.name !== 'string' || typeof record.text !== 'string') continue
    tabs.push({
      id: typeof record.id === 'string' ? record.id : makeId(),
      name: record.name,
      text: record.text,
      expand: sanitizeExpand(record.expand),
      params: typeof record.params === 'string' ? record.params : '',
    })
  }
  return tabs
}

/** localStorage-Persistenz ist migrationstolerant: kaputtes/fremdes JSON ⇒ Default-Tab (spec §2). */
function loadInitialState(): SqlState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return defaultState()
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeId?: unknown } | null
    const tabs = sanitizeTabs(parsed?.tabs)
    const firstTab = tabs[0]
    if (firstTab === undefined) return defaultState()
    const activeId =
      typeof parsed?.activeId === 'string' && tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId : firstTab.id
    return { tabs, activeId }
  } catch {
    return defaultState()
  }
}

let state: SqlState = loadInitialState()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Persistenz ist best-effort (Storage voll/deaktiviert) — der In-Memory-Store bleibt maßgeblich.
  }
}

function setState(next: SqlState): void {
  state = next
  persist()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): SqlState {
  return state
}

export function useSqlState(): SqlState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Neuer Tab (untitled-N.sql), optional mit Startinhalt, sofort aktiv. Gibt die neue Tab-Id zurück. */
export function addTab(text = ''): string {
  const tab: SqlTab = { id: makeId(), name: nextUntitledName(state.tabs), text, expand: [], params: '' }
  setState({ tabs: [...state.tabs, tab], activeId: tab.id })
  return tab.id
}

/** War der geschlossene Tab aktiv, übernimmt der linke Nachbar; der letzte Tab wird durch einen frischen ersetzt. */
export function closeTab(id: string): void {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  const fallback = tabs[Math.max(0, index - 1)] ?? tabs[0]
  if (fallback === undefined) {
    setState(defaultState())
    return
  }
  setState({ tabs, activeId: state.activeId === id ? fallback.id : state.activeId })
}

export function renameTab(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') return
  setState({ ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, name: trimmed } : tab)) })
}

export function setActiveTab(id: string): void {
  if (!state.tabs.some((tab) => tab.id === id)) return
  setState({ ...state, activeId: id })
}

export function updateTabText(id: string, text: string): void {
  setState({ ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, text } : tab)) })
}

export function setTabExpand(id: string, expand: string[]): void {
  setState({ ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, expand } : tab)) })
}

export function updateTabParams(id: string, params: string): void {
  setState({ ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, params } : tab)) })
}

/** Nur für Tests: In-Memory-Store aus dem aktuellen localStorage neu aufbauen. */
export function resetSqlState(): void {
  state = loadInitialState()
  for (const listener of listeners) listener()
}
