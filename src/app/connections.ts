import { authWithoutSecret } from './connectionRegistry'

// künftig: | { kind: 'shm'; … } (SHM/UDS-Local-Bypass, Backlog)
export type ConnectionType = { kind: 'rest'; url: string }
// künftig: | { kind: 'user-password'; … } (Server-Konzept steht aus)
export type AuthMethod = { kind: 'api-key'; key?: string }

export interface Connection {
  id: string
  name: string
  type: ConnectionType
  auth: AuthMethod
  lastUsed?: number
}

/** Migrations-tolerant: unbekannte Varianten werden nie verworfen, nur nicht angeboten. */
export type ConnectionEntry = { supported: true; connection: Connection } | { supported: false; id: string; name: string }

const STORAGE_KEY = 'luradb.connections'
const SCHEMA_VERSION = 1

interface RawStore {
  schemaVersion: 1
  connections: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isConnectionType(value: unknown): value is ConnectionType {
  return isRecord(value) && value.kind === 'rest' && typeof value.url === 'string'
}

function isAuthMethod(value: unknown): value is AuthMethod {
  return isRecord(value) && value.kind === 'api-key' && (value.key === undefined || typeof value.key === 'string')
}

function isConnection(value: unknown): value is Connection {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isConnectionType(value.type) &&
    isAuthMethod(value.auth) &&
    (value.lastUsed === undefined || typeof value.lastUsed === 'number')
  )
}

function readRawStore(): RawStore {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return { schemaVersion: SCHEMA_VERSION, connections: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.connections)) {
      return { schemaVersion: SCHEMA_VERSION, connections: parsed.connections }
    }
  } catch {
    // fällt durch zum leeren Store
  }
  return { schemaVersion: SCHEMA_VERSION, connections: [] }
}

function writeRawStore(store: RawStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function idOf(raw: unknown): string | undefined {
  return isRecord(raw) && typeof raw.id === 'string' ? raw.id : undefined
}

function nameOf(raw: unknown): string {
  return isRecord(raw) && typeof raw.name === 'string' ? raw.name : '(unknown connection)'
}

export function loadConnections(): ConnectionEntry[] {
  return readRawStore().connections.map((raw): ConnectionEntry => {
    if (isConnection(raw)) return { supported: true, connection: raw }
    return { supported: false, id: idOf(raw) ?? crypto.randomUUID(), name: nameOf(raw) }
  })
}

/** Persistiert `auth.key` nur, wenn `remember` gesetzt ist — sonst bleibt der Key nur im Session-Speicher. */
export function upsertConnection(connection: Connection, options: { remember: boolean }): void {
  const store = readRawStore()
  const persisted: Connection = options.remember ? connection : { ...connection, auth: authWithoutSecret(connection.auth) }
  const index = store.connections.findIndex((raw) => idOf(raw) === connection.id)
  if (index >= 0) store.connections[index] = persisted
  else store.connections.push(persisted)
  writeRawStore(store)
}

export function deleteConnection(id: string): void {
  const store = readRawStore()
  store.connections = store.connections.filter((raw) => idOf(raw) !== id)
  writeRawStore(store)
}

export function touchLastUsed(id: string): void {
  const store = readRawStore()
  const index = store.connections.findIndex((raw) => idOf(raw) === id)
  if (index === -1) return
  const raw = store.connections[index]
  if (isRecord(raw)) store.connections[index] = { ...raw, lastUsed: Date.now() }
  writeRawStore(store)
}

/** Secret-Hygiene: Keys erscheinen im UI nie im Klartext. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(key.length)
  return `${key.slice(0, 5)}…${key.slice(-2)}`
}
