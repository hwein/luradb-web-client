import { describe, expect, it } from 'vitest'
import { deleteConnection, loadConnections, maskKey, touchLastUsed, upsertConnection, type Connection } from './connections'

const STORAGE_KEY = 'luradb.connections'

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: undefined },
    ...overrides,
  }
}

describe('loadConnections', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadConnections()).toEqual([])
  })

  it('tolerates missing schemaVersion without crashing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ connections: [makeConnection()] }))
    expect(loadConnections()).toEqual([])
  })

  it('tolerates a foreign schemaVersion without crashing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, connections: [makeConnection()] }))
    expect(loadConnections()).toEqual([])
  })

  it('tolerates corrupt JSON without crashing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadConnections()).toEqual([])
  })

  it('lists unknown connection-type variants as unsupported instead of dropping them', () => {
    const unknown = { id: 'future-1', name: 'shm profile', type: { kind: 'shm' }, auth: { kind: 'api-key', key: 'lura_x' } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, connections: [unknown] }))

    expect(loadConnections()).toEqual([{ supported: false, id: 'future-1', name: 'shm profile' }])
  })

  it('lists unknown auth-method variants as unsupported instead of dropping them', () => {
    const unknown = {
      id: 'future-2',
      name: 'future auth',
      type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
      auth: { kind: 'user-password' },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, connections: [unknown] }))

    expect(loadConnections()).toEqual([{ supported: false, id: 'future-2', name: 'future auth' }])
  })
})

describe('upsertConnection', () => {
  it('persists the key when remember is true', () => {
    upsertConnection(makeConnection({ auth: { kind: 'api-key', key: 'lura_secret' } }), { remember: true })

    const [entry] = loadConnections()
    expect(entry).toEqual({ supported: true, connection: makeConnection({ auth: { kind: 'api-key', key: 'lura_secret' } }) })
  })

  it('strips the key when remember is false', () => {
    upsertConnection(makeConnection({ auth: { kind: 'api-key', key: 'lura_secret' } }), { remember: false })

    const [entry] = loadConnections()
    expect(entry).toEqual({ supported: true, connection: makeConnection({ auth: { kind: 'api-key', key: undefined } }) })
  })

  it('updates an existing connection in place rather than duplicating it', () => {
    upsertConnection(makeConnection({ name: 'first' }), { remember: false })
    upsertConnection(makeConnection({ name: 'renamed' }), { remember: false })

    expect(loadConnections()).toHaveLength(1)
  })

  it('never drops an unsupported entry when saving another connection', () => {
    const unknown = { id: 'future-1', name: 'shm profile', type: { kind: 'shm' }, auth: { kind: 'api-key', key: 'lura_x' } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, connections: [unknown] }))

    upsertConnection(makeConnection(), { remember: false })

    const entries = loadConnections()
    expect(entries).toHaveLength(2)
    expect(entries).toContainEqual({ supported: false, id: 'future-1', name: 'shm profile' })
  })
})

describe('deleteConnection', () => {
  it('removes the connection, including its stored key', () => {
    upsertConnection(makeConnection({ auth: { kind: 'api-key', key: 'lura_secret' } }), { remember: true })
    deleteConnection('conn-1')

    expect(loadConnections()).toEqual([])
  })
})

describe('touchLastUsed', () => {
  it('sets lastUsed on the stored connection', () => {
    upsertConnection(makeConnection(), { remember: false })
    touchLastUsed('conn-1')

    const entries = loadConnections()
    const [entry] = entries
    expect(entry?.supported).toBe(true)
    expect(entry?.supported && entry.connection.lastUsed).toEqual(expect.any(Number))
  })

  it('is a no-op for an id that is not stored', () => {
    touchLastUsed('does-not-exist')
    expect(loadConnections()).toEqual([])
  })
})

describe('maskKey', () => {
  it('keeps a short prefix and suffix for long keys', () => {
    expect(maskKey('lura_1234567890abcdef1240')).toBe('lura_…40')
  })

  it('fully masks short keys', () => {
    expect(maskKey('short')).toBe('•••••')
  })
})
