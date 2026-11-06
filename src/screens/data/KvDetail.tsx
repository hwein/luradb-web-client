import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, BASE_PATH, type ApiClient } from '../../api'
import { CodeEditor } from '../../lib'
import { openDocs } from '../docs/openDocs'
import {
  deleteValue,
  formatShortDuration,
  invalidateKvKeys,
  kvMetaQueryOptions,
  kvValueQueryOptions,
  parseTtlSeconds,
  putValue,
  setNullValue,
  tryParseJson,
  type KvMeta,
  type KvValue,
} from './kvEntries'

export type KvDetailMode = { kind: 'empty' } | { kind: 'view'; key: string } | { kind: 'new' }

interface KvDetailProps {
  domain: string
  apiClient: ApiClient | undefined
  mode: KvDetailMode
  onCreated: (key: string) => void
  onClear: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

function isPreconditionFailed(error: unknown): boolean {
  return error instanceof ApiError && error.status === 412
}

function etagOf(value: KvValue | undefined): string | undefined {
  return value !== undefined && value.state !== 'not-found' ? value.etag : undefined
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`
}

/** Pretty-printed wenn als JSON parsebar, sonst der Roh-Text unverändert (spec §3) — Werte sind Roh-Bytes, kein JSON-Zwang. */
function renderValue(text: string): string {
  const parsed = tryParseJson(text)
  return parsed !== undefined ? JSON.stringify(parsed, null, 2) : text
}

/** Zusätze der Meta-Zeile (spec data/012 §3) als Momentaufnahme des Renders — kein Ticker; ohne Metadaten (lädt/404) bleibt die Zeile wie zuvor.
 *  Expiry nur im Wert-Fall: ein Null-Write löscht die TTL (Probe-Fakt), das Null-Segment trägt daher nie eines. */
function metaSuffix(meta: KvMeta | null | undefined, withExpiry: boolean): string {
  if (meta === null || meta === undefined) return ''
  const nowSecs = Date.now() / 1000
  const parts: string[] = []
  if (withExpiry && meta.expiresAtSecs !== undefined) {
    const remaining = meta.expiresAtSecs - nowSecs
    parts.push(remaining <= 0 ? 'expired' : `expires in ${formatShortDuration(remaining)}`)
  }
  parts.push(`modified ${formatShortDuration(nowSecs - meta.lastModifiedMs / 1000)} ago`)
  return parts.map((part) => ` · ${part}`).join('')
}

/** Detail-Spalte (spec §3): Ansicht/Edit/Set-null/Delete eines Keys, "new key"-Formular, Raw-Pfad-Fuß. */
export function KvDetail({ domain, apiClient, mode, onCreated, onClear }: KvDetailProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const viewKey = mode.kind === 'view' ? mode.key : undefined
  const valueQuery = useQuery(kvValueQueryOptions(apiClient, domain, viewKey))
  const metaQuery = useQuery(kvMetaQueryOptions(apiClient, domain, viewKey))

  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editTtlText, setEditTtlText] = useState('')
  const [editTtlError, setEditTtlError] = useState<string | undefined>(undefined)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [nullArmed, setNullArmed] = useState(false)
  // ETag of the state the user saw at edit start / arming click; a background refetch must not change it.
  const [heldEtag, setHeldEtag] = useState<string | undefined>(undefined)
  const [reloadedNote, setReloadedNote] = useState<string | undefined>(undefined)

  const [newKey, setNewKey] = useState('')
  const [newText, setNewText] = useState('')
  const [newTtlText, setNewTtlText] = useState('')
  const [newError, setNewError] = useState<string | undefined>(undefined)

  // Moduswechsel (andere Auswahl, "+ new", Klick auf leer) verlässt Edit-/Bestätigungs-Zustände.
  useEffect(() => {
    setEditing(false)
    setDeleteArmed(false)
    setNullArmed(false)
    setReloadedNote(undefined)
  }, [mode])

  // Jeder Write ändert `last_modified_at` und setzt/löscht die TTL — die Meta-Query zieht mit dem Value mit (spec data/012 §4).
  function invalidate(key: string): void {
    void queryClient.invalidateQueries({ queryKey: ['kv-value', domain, key] })
    void queryClient.invalidateQueries({ queryKey: ['kv-meta', domain, key] })
    invalidateKvKeys(queryClient, domain)
  }

  const saveMutation = useMutation<void, unknown, { key: string; etag: string | undefined; value: string; ttlSeconds: number | undefined }>({
    mutationFn: async ({ key, etag, value, ttlSeconds }) => {
      if (!apiClient) throw new Error('no active connection')
      await putValue(apiClient, domain, key, value, ttlSeconds, { etag })
    },
    onSuccess: (_data, variables) => {
      setEditing(false)
      setReloadedNote(undefined)
      invalidate(variables.key)
    },
  })

  const setNullMutation = useMutation<void, unknown, { key: string; etag: string | undefined }>({
    mutationFn: async ({ key, etag }) => {
      if (!apiClient) throw new Error('no active connection')
      await setNullValue(apiClient, domain, key, etag)
    },
    onSuccess: (_data, { key }) => {
      setNullArmed(false)
      setReloadedNote(undefined)
      invalidate(key)
    },
  })

  const deleteMutation = useMutation<void, unknown, { key: string; etag: string | undefined }>({
    mutationFn: async ({ key, etag }) => {
      if (!apiClient) throw new Error('no active connection')
      await deleteValue(apiClient, domain, key, etag)
    },
    onSuccess: (_data, { key }) => {
      setReloadedNote(undefined)
      queryClient.removeQueries({ queryKey: ['kv-value', domain, key] })
      queryClient.removeQueries({ queryKey: ['kv-meta', domain, key] })
      invalidateKvKeys(queryClient, domain)
      setDeleteArmed(false)
      onClear()
    },
  })

  const createMutation = useMutation<string, unknown, { key: string; value: string; ttlSeconds: number | undefined }>({
    mutationFn: async ({ key, value, ttlSeconds }) => {
      if (!apiClient) throw new Error('no active connection')
      await putValue(apiClient, domain, key, value, ttlSeconds, { createOnly: true })
      return key
    },
    onSuccess: (createdKey) => {
      invalidateKvKeys(queryClient, domain)
      setNewKey('')
      setNewText('')
      setNewTtlText('')
      onCreated(createdKey)
    },
  })

  // 404 ⇒ Key existiert nicht (gelöscht ist gelöscht, Autor-Entscheid 2026-07-18) — Liste invalidieren und die Auswahl räumen.
  // Die Liste selbst beweist mit Paginierung nichts mehr: ein fehlender Key kann jenseits der geladenen Seiten liegen (spec data/011 §6).
  useEffect(() => {
    if (valueQuery.data?.state !== 'not-found') return
    invalidateKvKeys(queryClient, domain)
    onClear()
  }, [valueQuery.data, queryClient, domain, onClear])

  function handleEditStart(): void {
    if (valueQuery.data === undefined) return
    setEditText(valueQuery.data.state === 'found' ? valueQuery.data.text : '')
    setHeldEtag(etagOf(valueQuery.data))
    setReloadedNote(undefined)
    setEditTtlText('')
    setEditTtlError(undefined)
    setDeleteArmed(false)
    setNullArmed(false)
    setEditing(true)
  }

  function handleSaveEdit(): void {
    if (viewKey === undefined) return
    const ttl = parseTtlSeconds(editTtlText)
    if (!ttl.ok) {
      setEditTtlError(ttl.error)
      return
    }
    setEditTtlError(undefined)
    setReloadedNote(undefined)
    saveMutation.mutate({ key: viewKey, etag: heldEtag, value: editText, ttlSeconds: ttl.seconds })
  }

  function handleEditCancel(): void {
    setEditing(false)
    setReloadedNote(undefined)
  }

  function handleNullClick(): void {
    if (!nullArmed) {
      setNullArmed(true)
      setDeleteArmed(false)
      setHeldEtag(etagOf(valueQuery.data))
      setReloadedNote(undefined)
      return
    }
    setReloadedNote(undefined)
    if (viewKey !== undefined) setNullMutation.mutate({ key: viewKey, etag: heldEtag })
  }

  function handleDeleteClick(): void {
    if (!deleteArmed) {
      setDeleteArmed(true)
      setNullArmed(false)
      setHeldEtag(etagOf(valueQuery.data))
      setReloadedNote(undefined)
      return
    }
    setReloadedNote(undefined)
    if (viewKey !== undefined) deleteMutation.mutate({ key: viewKey, etag: heldEtag })
  }

  // Keeps editor text and armed state; only the held ETag moves to the freshly loaded one.
  async function handleReload(): Promise<void> {
    if (viewKey === undefined) return
    const note = editing
      ? 'reloaded — saving now overwrites the server version'
      : nullArmed
        ? 'reloaded — setting null now overwrites the server version'
        : 'reloaded — deleting now removes the server version'
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['kv-value', domain, viewKey] }),
      queryClient.invalidateQueries({ queryKey: ['kv-meta', domain, viewKey] }),
    ])
    setHeldEtag(etagOf(queryClient.getQueryData(kvValueQueryOptions(apiClient, domain, viewKey).queryKey)))
    saveMutation.reset()
    setNullMutation.reset()
    deleteMutation.reset()
    setReloadedNote(note)
  }

  function openConflictDocs(): void {
    openDocs('errors-status-codes')
    void navigate('/docs')
  }

  function handleCreate(): void {
    const trimmedKey = newKey.trim()
    if (trimmedKey === '') {
      setNewError('key is required')
      return
    }
    const ttl = parseTtlSeconds(newTtlText)
    if (!ttl.ok) {
      setNewError(ttl.error)
      return
    }
    setNewError(undefined)
    createMutation.mutate({ key: trimmedKey, value: newText, ttlSeconds: ttl.seconds })
  }

  if (mode.kind === 'empty') {
    return (
      <div className="kv-detail">
        <div className="kv-list__hint">select a key</div>
      </div>
    )
  }

  if (mode.kind === 'new') {
    return (
      <div className="kv-detail">
        <div className="kv-detail__head">
          <span className="mono-label">NEW KEY</span>
        </div>
        <div className="kv-detail__new-row">
          <input
            className="kv-detail__key-input"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            placeholder="key"
            aria-label="new key name"
            spellCheck={false}
          />
          <input
            className="kv-detail__ttl-input"
            value={newTtlText}
            onChange={(event) => setNewTtlText(event.target.value)}
            placeholder="ttl (seconds)"
            aria-label="ttl (seconds)"
            spellCheck={false}
          />
        </div>
        <div className="kv-detail__editor">
          <CodeEditor value={newText} onChange={setNewText} ariaLabel="new key value editor" placeholder="value" />
        </div>
        {newError !== undefined && <div className="kv-detail__error">{newError}</div>}
        {createMutation.isError && (
          <div className="kv-detail__error">
            {createMutation.error instanceof ApiError && createMutation.error.status === 412
              ? 'key already exists'
              : `create failed: ${messageOf(createMutation.error)}`}
          </div>
        )}
        <div className="kv-detail__edit-actions">
          <button type="button" className="kv-detail__save" onClick={handleCreate} disabled={createMutation.isPending}>
            create
          </button>
          <button type="button" className="kv-detail__cancel" onClick={onClear}>
            cancel
          </button>
        </div>
      </div>
    )
  }

  if (valueQuery.isLoading) {
    return (
      <div className="kv-detail">
        <div className="kv-list__hint">loading…</div>
      </div>
    )
  }

  if (valueQuery.isError || valueQuery.data === undefined) {
    return (
      <div className="kv-detail">
        <div className="kv-list__hint">failed to load value</div>
      </div>
    )
  }

  if (valueQuery.data.state === 'not-found') {
    return (
      <div className="kv-detail">
        <div className="kv-list__hint">select a key</div>
      </div>
    )
  }

  const value = valueQuery.data
  const key = mode.key
  const conflict =
    (saveMutation.isError && isPreconditionFailed(saveMutation.error)) ||
    (setNullMutation.isError && isPreconditionFailed(setNullMutation.error)) ||
    (deleteMutation.isError && isPreconditionFailed(deleteMutation.error))

  return (
    <div className="kv-detail">
      <div className="kv-detail__head">
        <span className="kv-detail__key-label">KEY {key}</span>
        {editing ? (
          <span className="kv-detail__actions">
            <button type="button" onClick={handleSaveEdit}>
              save
            </button>{' '}
            ·{' '}
            <button type="button" onClick={handleEditCancel}>
              cancel
            </button>
          </span>
        ) : (
          <span className="kv-detail__actions">
            <button type="button" onClick={handleEditStart}>
              edit
            </button>{' '}
            ·{' '}
            <button type="button" className={nullArmed ? 'kv-detail__action--armed' : undefined} onClick={handleNullClick}>
              {nullArmed ? 'set null — sure?' : 'set null'}
            </button>{' '}
            ·{' '}
            <button type="button" className={deleteArmed ? 'kv-detail__action--armed' : undefined} onClick={handleDeleteClick}>
              {deleteArmed ? 'delete — sure?' : 'delete'}
            </button>
          </span>
        )}
      </div>

      {editing ? (
        <>
          <input
            className="kv-detail__ttl-input"
            value={editTtlText}
            onChange={(event) => setEditTtlText(event.target.value)}
            placeholder="ttl (seconds)"
            aria-label="ttl (seconds)"
            spellCheck={false}
          />
          {editTtlError !== undefined && <div className="kv-detail__error">{editTtlError}</div>}
          <div className="kv-detail__editor">
            <CodeEditor value={editText} onChange={setEditText} ariaLabel="value editor" placeholder="value" />
          </div>
        </>
      ) : value.state === 'null' ? (
        <>
          <pre className="kv-detail__value kv-detail__value--null">NULL</pre>
          <div className="kv-detail__meta">explicit null state — GET answers 204{metaSuffix(metaQuery.data, false)}</div>
        </>
      ) : (
        <>
          <pre className="kv-detail__value">{renderValue(value.text)}</pre>
          <div className="kv-detail__meta">
            {formatBytes(value.bytes)}
            {metaSuffix(metaQuery.data, true)}
          </div>
        </>
      )}

      {conflict && (
        <div className="kv-detail__conflict">
          version conflict — the key changed on the server ·{' '}
          <button type="button" className="kv-detail__link" onClick={() => void handleReload()}>
            reload
          </button>{' '}
          ·{' '}
          <button type="button" className="kv-detail__link" onClick={openConflictDocs}>
            docs
          </button>
        </div>
      )}
      {reloadedNote !== undefined && <div className="kv-detail__conflict">{reloadedNote}</div>}
      {saveMutation.isError && !isPreconditionFailed(saveMutation.error) && (
        <div className="kv-detail__error">save failed: {messageOf(saveMutation.error)}</div>
      )}
      {setNullMutation.isError && !isPreconditionFailed(setNullMutation.error) && (
        <div className="kv-detail__error">set null failed: {messageOf(setNullMutation.error)}</div>
      )}
      {deleteMutation.isError && !isPreconditionFailed(deleteMutation.error) && (
        <div className="kv-detail__error">delete failed: {messageOf(deleteMutation.error)}</div>
      )}

      <div className="kv-detail__raw-path mono-path">
        GET {BASE_PATH}/kv/{domain}/keys/{key}
      </div>
    </div>
  )
}
