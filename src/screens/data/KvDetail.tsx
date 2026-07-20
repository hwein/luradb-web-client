import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BASE_PATH, type ApiClient } from '../../api'
import { CodeEditor } from '../../lib'
import { deleteValue, invalidateKvKeys, kvValueQueryOptions, parseTtlSeconds, putValue, setNullValue, tryParseJson } from './kvEntries'

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

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`
}

/** Pretty-printed wenn als JSON parsebar, sonst der Roh-Text unverändert (spec §3) — Werte sind Roh-Bytes, kein JSON-Zwang. */
function renderValue(text: string): string {
  const parsed = tryParseJson(text)
  return parsed !== undefined ? JSON.stringify(parsed, null, 2) : text
}

/** Detail-Spalte (spec §3): Ansicht/Edit/Set-null/Delete eines Keys, "new key"-Formular, Raw-Pfad-Fuß. */
export function KvDetail({ domain, apiClient, mode, onCreated, onClear }: KvDetailProps) {
  const queryClient = useQueryClient()

  const viewKey = mode.kind === 'view' ? mode.key : undefined
  const valueQuery = useQuery(kvValueQueryOptions(apiClient, domain, viewKey))

  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editTtlText, setEditTtlText] = useState('')
  const [editTtlError, setEditTtlError] = useState<string | undefined>(undefined)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [nullArmed, setNullArmed] = useState(false)

  const [newKey, setNewKey] = useState('')
  const [newText, setNewText] = useState('')
  const [newTtlText, setNewTtlText] = useState('')
  const [newError, setNewError] = useState<string | undefined>(undefined)

  // Moduswechsel (andere Auswahl, "+ new", Klick auf leer) verlässt Edit-/Bestätigungs-Zustände.
  useEffect(() => {
    setEditing(false)
    setDeleteArmed(false)
    setNullArmed(false)
  }, [mode])

  function invalidate(key: string): void {
    void queryClient.invalidateQueries({ queryKey: ['kv-value', domain, key] })
    invalidateKvKeys(queryClient, domain)
  }

  const saveMutation = useMutation<void, unknown, { key: string; value: string; ttlSeconds: number | undefined }>({
    mutationFn: async ({ key, value, ttlSeconds }) => {
      if (!apiClient) throw new Error('no active connection')
      await putValue(apiClient, domain, key, value, ttlSeconds)
    },
    onSuccess: (_data, variables) => {
      setEditing(false)
      invalidate(variables.key)
    },
  })

  const setNullMutation = useMutation<void, unknown, string>({
    mutationFn: async (key) => {
      if (!apiClient) throw new Error('no active connection')
      await setNullValue(apiClient, domain, key)
    },
    onSuccess: (_data, key) => {
      setNullArmed(false)
      invalidate(key)
    },
  })

  const deleteMutation = useMutation<void, unknown, string>({
    mutationFn: async (key) => {
      if (!apiClient) throw new Error('no active connection')
      await deleteValue(apiClient, domain, key)
    },
    onSuccess: (_data, key) => {
      queryClient.removeQueries({ queryKey: ['kv-value', domain, key] })
      invalidateKvKeys(queryClient, domain)
      setDeleteArmed(false)
      onClear()
    },
  })

  const createMutation = useMutation<string, unknown, { key: string; value: string; ttlSeconds: number | undefined }>({
    mutationFn: async ({ key, value, ttlSeconds }) => {
      if (!apiClient) throw new Error('no active connection')
      await putValue(apiClient, domain, key, value, ttlSeconds)
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

  // 404 ⇒ Key existiert nicht (gelöscht ist gelöscht, Autor-Entscheid 2026-07-18) — Liste invalidieren; KvBrowser räumt die Auswahl über die frische Liste.
  useEffect(() => {
    if (valueQuery.data?.state === 'not-found') invalidateKvKeys(queryClient, domain)
  }, [valueQuery.data, queryClient, domain])

  function handleEditStart(): void {
    if (valueQuery.data === undefined) return
    setEditText(valueQuery.data.state === 'found' ? valueQuery.data.text : '')
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
    saveMutation.mutate({ key: viewKey, value: editText, ttlSeconds: ttl.seconds })
  }

  function handleNullClick(): void {
    if (!nullArmed) {
      setNullArmed(true)
      setDeleteArmed(false)
      return
    }
    if (viewKey !== undefined) setNullMutation.mutate(viewKey)
  }

  function handleDeleteClick(): void {
    if (!deleteArmed) {
      setDeleteArmed(true)
      setNullArmed(false)
      return
    }
    if (viewKey !== undefined) deleteMutation.mutate(viewKey)
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
        {createMutation.isError && <div className="kv-detail__error">create failed: {messageOf(createMutation.error)}</div>}
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
            <button type="button" onClick={() => setEditing(false)}>
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
      ) : (
        <>
          <pre className="kv-detail__value">{renderValue(value.text)}</pre>
          <div className="kv-detail__meta">{formatBytes(value.bytes)}</div>
        </>
      )}

      {saveMutation.isError && <div className="kv-detail__error">save failed: {messageOf(saveMutation.error)}</div>}
      {setNullMutation.isError && <div className="kv-detail__error">set null failed: {messageOf(setNullMutation.error)}</div>}
      {deleteMutation.isError && <div className="kv-detail__error">delete failed: {messageOf(deleteMutation.error)}</div>}

      <div className="kv-detail__raw-path mono-path">
        GET {BASE_PATH}/kv/{domain}/keys/{key}
      </div>
    </div>
  )
}
