import { useState } from 'react'
import './ConnectionGate.css'
import { LogoMark } from '../brand/LogoMark'
import { ConnectionForm, type FormTarget } from './ConnectionForm'
import type { Connection, ConnectionEntry } from './connections'
import { deleteConnection, loadConnections, upsertConnection } from './connections'
import { connect, useSession } from './session'

/** Vollflächiges Login-Gate = Verbindungsverwaltung (kein Design-Prototyp — Panel-/Mono-Ästhetik der Tokens). */
export function ConnectionGate() {
  const session = useSession()
  const [entries, setEntries] = useState<ConnectionEntry[]>(() => loadConnections())
  const [formTarget, setFormTarget] = useState<FormTarget | null>(() => (entries.length === 0 ? { mode: 'create' } : null))
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function refresh(): void {
    setEntries(loadConnections())
  }

  function handleConnect(connection: Connection): void {
    if (connection.auth.key === undefined) {
      setFormTarget({ mode: 'connect', connection })
      return
    }
    void connect(connection)
  }

  function handleFormSubmit(connection: Connection, remember: boolean): void {
    const wasConnectDialog = formTarget?.mode === 'connect'
    upsertConnection(connection, { remember })
    refresh()
    setFormTarget(null)
    if (wasConnectDialog) void connect(connection)
  }

  function handleDeleteConfirm(id: string): void {
    deleteConnection(id)
    refresh()
    setConfirmDeleteId(null)
  }

  return (
    <div className="connection-gate">
      <div className="connection-gate__stack">
        <div className="connection-gate__brand">
          <LogoMark size={84} />
          <h1 className="connection-gate__wordmark" aria-label="LuraDB">
            Lura<span className="connection-gate__wordmark-db">DB</span>
          </h1>
          <span className="connection-gate__product">WEB CLIENT</span>
        </div>

        <div className="connection-gate__panel">
          {session.status === 'error' && (
            <p className="connection-gate__banner connection-gate__banner--error" role="alert">
              {session.message}
            </p>
          )}
          {session.status === 'connecting' && <p className="connection-gate__banner">connecting…</p>}

          {entries.length > 0 && (
            <ul className="connection-gate__list">
              {entries.map((entry) => {
                const id = entry.supported ? entry.connection.id : entry.id
                return (
                  <ConnectionRow
                    key={id}
                    entry={entry}
                    confirmingDelete={confirmDeleteId === id}
                    onConnect={handleConnect}
                    onEdit={(connection) => setFormTarget({ mode: 'edit', connection })}
                    onDeleteRequest={() => setConfirmDeleteId(id)}
                    onDeleteCancel={() => setConfirmDeleteId(null)}
                    onDeleteConfirm={() => handleDeleteConfirm(id)}
                  />
                )
              })}
            </ul>
          )}

          {formTarget === null ? (
            <button type="button" className="connection-gate__new" onClick={() => setFormTarget({ mode: 'create' })}>
              + new connection
            </button>
          ) : (
            <ConnectionForm target={formTarget} onSubmit={handleFormSubmit} onCancel={() => setFormTarget(null)} />
          )}
        </div>
      </div>
    </div>
  )
}

interface ConnectionRowProps {
  entry: ConnectionEntry
  confirmingDelete: boolean
  onConnect: (connection: Connection) => void
  onEdit: (connection: Connection) => void
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}

function ConnectionRow({ entry, confirmingDelete, onConnect, onEdit, onDeleteRequest, onDeleteCancel, onDeleteConfirm }: ConnectionRowProps) {
  const name = entry.supported ? entry.connection.name : entry.name

  return (
    <li className="connection-gate__row">
      <div className="connection-gate__row-main">
        <span className="connection-gate__name">{name}</span>
        {entry.supported ? (
          <span className="mono-path">
            {entry.connection.type.url} · {entry.connection.lastUsed ? new Date(entry.connection.lastUsed).toLocaleString() : 'never connected'}
          </span>
        ) : (
          <span className="mono-path">unsupported (newer app version required)</span>
        )}
      </div>
      {confirmingDelete ? (
        <div className="connection-gate__row-actions">
          <span className="mono-path">delete this connection?</span>
          <button type="button" onClick={onDeleteConfirm}>
            yes
          </button>
          <button type="button" onClick={onDeleteCancel}>
            cancel
          </button>
        </div>
      ) : (
        <div className="connection-gate__row-actions">
          {entry.supported && (
            <>
              <button type="button" onClick={() => onConnect(entry.connection)}>
                connect
              </button>
              <button type="button" onClick={() => onEdit(entry.connection)}>
                edit
              </button>
            </>
          )}
          <button type="button" onClick={onDeleteRequest}>
            delete
          </button>
        </div>
      )}
    </li>
  )
}
