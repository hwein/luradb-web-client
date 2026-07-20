import { json } from '@codemirror/lang-json'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { BASE_PATH, type ApiClient } from '../../api'
import { CodeEditor } from '../../lib'
import { openDocs } from '../docs/openDocs'
import {
  assertKeyAvailable,
  createDocument,
  deleteDocument,
  isConflict,
  jsonDocumentQueryOptions,
  KeyExistsError,
  putDocument,
  safeJsonParse,
} from './jsonDocuments'
import { useReferencedBy } from './referencedBy'

export type DetailMode = { kind: 'empty' } | { kind: 'view'; key: string } | { kind: 'new' }

const JSON_EXTENSIONS = [json()]
const NEW_DOCUMENT_TEXT = '{\n  \n}'

interface JsonDetailProps {
  domain: string
  apiClient: ApiClient | undefined
  mode: DetailMode
  onSelectKey: (key: string) => void
  onClear: () => void
  onOpenRelTable: (table: string, filterCol: string, filterVal: string) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/** Detail-Spalte (spec §4): Ansicht/Edit/Delete eines Dokuments, "new document"-Formular, Referenced-by-Karten. */
export function JsonDetail({ domain, apiClient, mode, onSelectKey, onClear, onOpenRelTable }: JsonDetailProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const viewKey = mode.kind === 'view' ? mode.key : undefined
  const detailQuery = useQuery(jsonDocumentQueryOptions(apiClient, domain, viewKey))
  const referencedBy = useReferencedBy(apiClient, domain, viewKey)

  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [deleteArmed, setDeleteArmed] = useState(false)

  const [newKey, setNewKey] = useState('')
  const [newText, setNewText] = useState(NEW_DOCUMENT_TEXT)
  const [newError, setNewError] = useState<string | undefined>(undefined)

  // Moduswechsel (andere Auswahl, "+ new", Klick auf leer) verlässt Edit-/Löschbestätigung.
  useEffect(() => {
    setEditing(false)
    setEditError(undefined)
    setDeleteArmed(false)
  }, [mode])

  // Key/ETag als Mutation-Variablen (nicht aus dem Closure) — bleibt korrekt, falls die Auswahl wechselt, während der Request läuft.
  const saveMutation = useMutation<void, unknown, { key: string; etag: string | undefined; fields: unknown }>({
    mutationFn: async ({ key, etag, fields }) => {
      if (!apiClient) throw new Error('no active connection')
      await putDocument(apiClient, domain, key, etag, fields)
    },
    onSuccess: (_data, variables) => {
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: ['json-document', domain, variables.key] })
      void queryClient.invalidateQueries({ queryKey: ['json-documents', domain] })
    },
  })

  const deleteMutation = useMutation<void, unknown, string>({
    mutationFn: async (key) => {
      if (!apiClient) throw new Error('no active connection')
      await deleteDocument(apiClient, domain, key)
    },
    onSuccess: (_data, key) => {
      queryClient.removeQueries({ queryKey: ['json-document', domain, key] })
      void queryClient.invalidateQueries({ queryKey: ['json-documents', domain] })
      void queryClient.invalidateQueries({ queryKey: ['json-domain-detail', domain] })
      setDeleteArmed(false)
      onClear()
    },
  })

  const createMutation = useMutation<string, unknown, { key: string | undefined; fields: unknown }>({
    mutationFn: async ({ key, fields }) => {
      if (!apiClient) throw new Error('no active connection')
      if (key === undefined) return createDocument(apiClient, domain, fields)
      await assertKeyAvailable(apiClient, domain, key)
      await putDocument(apiClient, domain, key, undefined, fields)
      return key
    },
    onSuccess: (createdKey) => {
      void queryClient.invalidateQueries({ queryKey: ['json-documents', domain] })
      void queryClient.invalidateQueries({ queryKey: ['json-domain-detail', domain] })
      setNewKey('')
      setNewText(NEW_DOCUMENT_TEXT)
      onSelectKey(createdKey)
    },
  })

  function handleEditStart(): void {
    if (detailQuery.data === undefined) return
    setEditText(JSON.stringify(detailQuery.data.fields, null, 2))
    setEditError(undefined)
    setEditing(true)
  }

  function handleSaveEdit(): void {
    if (viewKey === undefined) return
    const parsed = safeJsonParse(editText)
    if (!parsed.ok) {
      setEditError(parsed.error)
      return
    }
    setEditError(undefined)
    saveMutation.mutate({ key: viewKey, etag: detailQuery.data?.etag, fields: parsed.value })
  }

  function handleDeleteClick(): void {
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    if (viewKey !== undefined) deleteMutation.mutate(viewKey)
  }

  function handleCreate(): void {
    const parsed = safeJsonParse(newText)
    if (!parsed.ok) {
      setNewError(parsed.error)
      return
    }
    setNewError(undefined)
    const trimmedKey = newKey.trim()
    createMutation.mutate({ key: trimmedKey === '' ? undefined : trimmedKey, fields: parsed.value })
  }

  function openConflictDocs(): void {
    openDocs('errors-status-codes')
    void navigate('/docs')
  }

  if (mode.kind === 'empty') {
    return (
      <div className="json-detail">
        <div className="json-list__hint">select a document</div>
      </div>
    )
  }

  if (mode.kind === 'new') {
    return (
      <div className="json-detail">
        <div className="json-detail__head">
          <span className="mono-label">NEW DOCUMENT</span>
        </div>
        <input
          className="json-detail__key-input"
          value={newKey}
          onChange={(event) => setNewKey(event.target.value)}
          placeholder="auto (uuid)"
          aria-label="new document key"
          spellCheck={false}
        />
        <div className="json-detail__editor">
          <CodeEditor value={newText} onChange={setNewText} extensions={JSON_EXTENSIONS} ariaLabel="new document editor" />
        </div>
        {newError !== undefined && <div className="json-detail__conflict">{newError}</div>}
        {createMutation.isError && (
          <div className="json-detail__conflict">
            {createMutation.error instanceof KeyExistsError ? messageOf(createMutation.error) : `create failed: ${messageOf(createMutation.error)}`}
          </div>
        )}
        <div className="json-detail__edit-actions">
          <button type="button" className="json-detail__save" onClick={handleCreate} disabled={createMutation.isPending}>
            create
          </button>
          <button type="button" className="json-detail__cancel" onClick={onClear}>
            cancel
          </button>
        </div>
      </div>
    )
  }

  if (detailQuery.isLoading) {
    return (
      <div className="json-detail">
        <div className="json-list__hint">loading…</div>
      </div>
    )
  }

  if (detailQuery.isError || detailQuery.data === undefined) {
    return (
      <div className="json-detail">
        <div className="json-list__hint">failed to load document</div>
      </div>
    )
  }

  const doc = detailQuery.data
  const usedReferences = referencedBy.filter((card) => (card.rowCount ?? 0) > 0)

  return (
    <div className="json-detail">
      <div className="json-detail__head">
        <span className="json-detail__doc-label">DOCUMENT {doc.key}</span>
        {editing ? (
          <span className="json-detail__actions">
            <button type="button" onClick={handleSaveEdit}>
              save
            </button>{' '}
            ·{' '}
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setEditError(undefined)
              }}
            >
              cancel
            </button>
          </span>
        ) : (
          <span className="json-detail__actions">
            <button type="button" onClick={handleEditStart}>
              edit
            </button>{' '}
            ·{' '}
            <button type="button" className={deleteArmed ? 'json-detail__action--armed' : undefined} onClick={handleDeleteClick}>
              {deleteArmed ? 'delete — sure?' : 'delete'}
            </button>
          </span>
        )}
      </div>

      {deleteArmed && usedReferences.length > 0 && (
        <div className="json-detail__delete-info">
          {usedReferences.map((card) => (
            <div key={`${card.table}.${card.column}`}>
              referenced by {card.rowCount} rows in {card.table}.{card.column}
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div className="json-detail__editor">
          <CodeEditor value={editText} onChange={setEditText} extensions={JSON_EXTENSIONS} ariaLabel="document editor" />
        </div>
      ) : (
        <pre className="json-detail__pretty">{JSON.stringify(doc.fields, null, 2)}</pre>
      )}

      {editError !== undefined && <div className="json-detail__conflict">{editError}</div>}
      {saveMutation.isError && isConflict(saveMutation.error) && (
        <div className="json-detail__conflict">
          version conflict — reload document ·{' '}
          <button type="button" className="json-detail__doc-link" onClick={openConflictDocs}>
            docs
          </button>
        </div>
      )}
      {saveMutation.isError && !isConflict(saveMutation.error) && (
        <div className="json-detail__conflict">save failed: {messageOf(saveMutation.error)}</div>
      )}
      {deleteMutation.isError && <div className="json-detail__conflict">delete failed: {messageOf(deleteMutation.error)}</div>}

      {referencedBy.length > 0 && (
        <>
          <div className="mono-label">REFERENCED BY (CROSS-ENGINE)</div>
          <div className="json-detail__refs">
            {referencedBy.map((card) => {
              const clickable = card.rowCount !== undefined && card.rowCount > 0
              return (
                <button
                  key={`${card.table}.${card.column}`}
                  type="button"
                  className="json-detail__ref-card"
                  disabled={!clickable}
                  onClick={() => onOpenRelTable(card.table, card.column, doc.key)}
                >
                  <span className="data__chip data__chip--rel">T</span>
                  {card.table}.{card.column} · {card.rowCount === undefined ? '…' : `${card.rowCount} rows`}
                  {clickable && <span className="json-detail__ref-arrow">→</span>}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="json-detail__raw-path mono-path">
        GET {BASE_PATH}/json/{domain}/documents/{doc.key}
      </div>
    </div>
  )
}
