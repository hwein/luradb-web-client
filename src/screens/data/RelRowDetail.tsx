import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { jsonDocumentsQueryOptions } from './jsonDocuments'
import { kvKeysQueryOptions } from './kvEntries'
import {
  blankFormState,
  buildRowPayload,
  deleteRow,
  formStateFromRow,
  formatCellValue,
  insertRow,
  isConflict,
  updateRow,
  type RelRow,
  type RowFormState,
} from './relRows'

type ColumnInfo = components['schemas']['ColumnInfo']

export type RelDetailMode = { kind: 'empty' } | { kind: 'view'; pk: string } | { kind: 'new' }

interface RelRowDetailProps {
  domain: string
  apiClient: ApiClient | undefined
  table: string
  columns: ColumnInfo[]
  mode: RelDetailMode
  row: RelRow | undefined
  onCreated: (pk: string) => void
  onDeleted: () => void
  onClear: () => void
  onConflictDocs: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

function ErrorLine({ error, onConflictDocs }: { error: unknown; onConflictDocs: () => void }) {
  if (isConflict(error)) {
    return (
      <div className="rel-detail__conflict">
        {messageOf(error)} ·{' '}
        <button type="button" className="rel-detail__doc-link" onClick={onConflictDocs}>
          why?
        </button>
      </div>
    )
  }
  return <div className="rel-detail__conflict">{messageOf(error)}</div>
}

interface RelRowFormProps {
  domain: string
  apiClient: ApiClient | undefined
  columns: ColumnInfo[]
  form: RowFormState
  isInsert: boolean
  onFieldText: (column: string, text: string) => void
  onFieldNull: (column: string, isNull: boolean) => void
}

const JSONREF_DATALIST_ID = 'rel-row-form-jsonref-options'
const KVREF_DATALIST_ID = 'rel-row-form-kvref-options'

/**
 * Feld-Formular aus dem Schema (orchestrator §4): INTEGER/REAL → number, sonst Text; nullable → null-Schalter; PK read-only/auto.
 * KVREF-/JSONREF-Felder bekommen zusätzlich eine <datalist> aus dem Bestand der Domäne (spec 004 §2) — freie Eingabe bleibt möglich.
 */
function RelRowForm({ domain, apiClient, columns, form, isInsert, onFieldText, onFieldNull }: RelRowFormProps) {
  const hasJsonref = columns.some((column) => column.type === 'JSONREF')
  const hasKvref = columns.some((column) => column.type === 'KVREF')

  // Geteilter Cache mit JsonBrowser/KvBrowser (gleiche Query-Options) — nur bereits geladene Seiten, kein fetch-all.
  const jsonrefQuery = useInfiniteQuery({
    ...jsonDocumentsQueryOptions(apiClient, domain, undefined),
    enabled: hasJsonref && apiClient !== undefined,
  })
  const kvrefQuery = useQuery({ ...kvKeysQueryOptions(apiClient, domain, ''), enabled: hasKvref && apiClient !== undefined })

  const jsonrefOptions = (jsonrefQuery.data?.pages ?? []).flatMap((page) => page.documents.map((doc) => doc.key))
  const kvrefOptions = kvrefQuery.data?.keys ?? []

  return (
    <div className="rel-detail__fields">
      {hasJsonref && (
        <datalist id={JSONREF_DATALIST_ID}>
          {jsonrefOptions.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
      )}
      {hasKvref && (
        <datalist id={KVREF_DATALIST_ID}>
          {kvrefOptions.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
      )}
      {columns.map((column) => {
        const field = form[column.name] ?? { text: '', isNull: false }
        const isAutoPk = column.primary_key && column.autoincrement
        const locked = isInsert ? isAutoPk : column.primary_key
        const listId = column.type === 'JSONREF' ? JSONREF_DATALIST_ID : column.type === 'KVREF' ? KVREF_DATALIST_ID : undefined
        return (
          <div className="rel-detail__form-row" key={column.name}>
            <span className="rel-detail__field-label">
              {column.name}
              {column.nullable && (
                <label className="rel-detail__null-toggle">
                  <input
                    type="checkbox"
                    checked={field.isNull}
                    aria-label={`${column.name} is null`}
                    onChange={(event) => onFieldNull(column.name, event.target.checked)}
                  />
                  null
                </label>
              )}
            </span>
            <input
              className="rel-detail__input"
              type={column.type === 'INTEGER' || column.type === 'REAL' ? 'number' : 'text'}
              value={field.text}
              disabled={locked || field.isNull}
              placeholder={isInsert && isAutoPk ? 'auto' : undefined}
              aria-label={column.name}
              list={listId}
              onChange={(event) => onFieldText(column.name, event.target.value)}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Detail-Spalte (spec §3): Feld-Formular aus dem Schema, edit/delete mit Bestätigung, "+ new row"-Formular, 409-Zeile mit why?-Link. */
export function RelRowDetail({ domain, apiClient, table, columns, mode, row, onCreated, onDeleted, onClear, onConflictDocs }: RelRowDetailProps) {
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<RowFormState>(() => blankFormState(columns))
  const [deleteArmed, setDeleteArmed] = useState(false)

  // Moduswechsel setzt Edit-/Bestätigungs-Zustände zurück, indem der Parent per key remountet (kein Reset-Effect:
  // der lief NACH einem schnellen edit-Klick und schloss das Formular wieder). Das Edit-Formular wird erst in
  // handleEditStart aus der aktuellen Zeile befüllt — ein Hintergrund-Refetch von `row` verwirft laufende Eingaben nicht.

  function invalidateRows(): void {
    void queryClient.invalidateQueries({ queryKey: ['rel-rows', domain, table] })
    void queryClient.invalidateQueries({ queryKey: ['rel-rows-filtered', domain, table] })
  }

  const insertMutation = useMutation<{ affected: number; lastPk: unknown }, unknown, Record<string, unknown>>({
    mutationFn: async (payload) => {
      if (!apiClient) throw new Error('no active connection')
      return insertRow(apiClient, domain, table, payload)
    },
    onSuccess: ({ lastPk }, payload) => {
      invalidateRows()
      const pkColumn = columns.find((column) => column.primary_key)?.name
      const fallback = pkColumn !== undefined ? payload[pkColumn] : undefined
      const pkValue = lastPk ?? fallback
      if (pkValue !== null && pkValue !== undefined) onCreated(String(pkValue))
      else onClear()
    },
  })

  const updateMutation = useMutation<void, unknown, { pk: string; payload: Record<string, unknown> }>({
    mutationFn: async ({ pk, payload }) => {
      if (!apiClient) throw new Error('no active connection')
      await updateRow(apiClient, domain, table, pk, payload)
    },
    onSuccess: () => {
      setEditing(false)
      invalidateRows()
    },
  })

  const deleteMutation = useMutation<void, unknown, string>({
    mutationFn: async (pk) => {
      if (!apiClient) throw new Error('no active connection')
      await deleteRow(apiClient, domain, table, pk)
    },
    onSuccess: () => {
      setDeleteArmed(false)
      invalidateRows()
      onDeleted()
    },
  })

  function handleFieldText(column: string, text: string): void {
    setForm((state) => ({ ...state, [column]: { text, isNull: state[column]?.isNull ?? false } }))
  }

  function handleFieldNull(column: string, isNull: boolean): void {
    setForm((state) => ({ ...state, [column]: { text: state[column]?.text ?? '', isNull } }))
  }

  function handleEditStart(): void {
    if (mode.kind !== 'view' || row === undefined) return
    setForm(formStateFromRow(columns, row))
    setDeleteArmed(false)
    setEditing(true)
  }

  function handleSaveEdit(): void {
    if (mode.kind !== 'view') return
    updateMutation.mutate({ pk: mode.pk, payload: buildRowPayload(columns, form, 'update') })
  }

  function handleDeleteClick(): void {
    if (mode.kind !== 'view') return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    deleteMutation.mutate(mode.pk)
  }

  function handleCreate(): void {
    insertMutation.mutate(buildRowPayload(columns, form, 'insert'))
  }

  if (mode.kind === 'empty') {
    return (
      <div className="rel-detail">
        <div className="rel-list__hint">select a row</div>
      </div>
    )
  }

  if (mode.kind === 'new') {
    return (
      <div className="rel-detail">
        <div className="rel-detail__head">
          <span className="mono-label">NEW ROW</span>
        </div>
        <RelRowForm domain={domain} apiClient={apiClient} columns={columns} form={form} isInsert onFieldText={handleFieldText} onFieldNull={handleFieldNull} />
        {insertMutation.isError && <ErrorLine error={insertMutation.error} onConflictDocs={onConflictDocs} />}
        <div className="rel-detail__edit-actions">
          <button type="button" className="rel-detail__save" onClick={handleCreate} disabled={insertMutation.isPending}>
            create
          </button>
          <button type="button" className="rel-detail__cancel" onClick={onClear}>
            cancel
          </button>
        </div>
      </div>
    )
  }

  if (row === undefined) {
    return (
      <div className="rel-detail">
        <div className="rel-list__hint">loading…</div>
      </div>
    )
  }

  return (
    <div className="rel-detail">
      <div className="rel-detail__head">
        <span className="rel-detail__label">ROW {mode.pk}</span>
        {editing ? (
          <span className="rel-detail__actions">
            <button type="button" onClick={handleSaveEdit}>
              save
            </button>{' '}
            ·{' '}
            <button type="button" onClick={() => setEditing(false)}>
              cancel
            </button>
          </span>
        ) : (
          <span className="rel-detail__actions">
            <button type="button" onClick={handleEditStart}>
              edit
            </button>{' '}
            ·{' '}
            <button type="button" className={deleteArmed ? 'rel-detail__action--armed' : undefined} onClick={handleDeleteClick}>
              {deleteArmed ? 'delete — sure?' : 'delete'}
            </button>
          </span>
        )}
      </div>

      {editing ? (
        <RelRowForm
          domain={domain}
          apiClient={apiClient}
          columns={columns}
          form={form}
          isInsert={false}
          onFieldText={handleFieldText}
          onFieldNull={handleFieldNull}
        />
      ) : (
        <div className="rel-detail__fields">
          {columns.map((column) => (
            <div className="rel-detail__field-row" key={column.name}>
              <span className="rel-detail__field-label">{column.name}</span>
              <span className="rel-detail__field-value">{formatCellValue(row[column.name])}</span>
            </div>
          ))}
        </div>
      )}

      {updateMutation.isError && <ErrorLine error={updateMutation.error} onConflictDocs={onConflictDocs} />}
      {deleteMutation.isError && <ErrorLine error={deleteMutation.error} onConflictDocs={onConflictDocs} />}
    </div>
  )
}
