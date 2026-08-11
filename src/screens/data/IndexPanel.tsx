import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { BASE_PATH, type ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { startReindex, type StartReindexOutcome } from '../engines/reindexStart'
import { createIndex, deleteIndex, formatIndexCreatedAt, INDEX_TYPES, type CreateIndexOutcome, type DeleteIndexOutcome, type IndexType } from './jsonIndexes'

type IndexResponse = components['schemas']['IndexResponse']

interface IndexPanelProps {
  domain: string
  apiClient: ApiClient
  indexes: IndexResponse[]
  loading: boolean
}

/** idx-Pill-Panel (spec data/006 §1/§2): Index-Liste + Anlage-Formular + Post-Create-Reindex-Hinweis — dokumentierte Ergänzung im Karten-Stil. */
export function IndexPanel({ domain, apiClient, indexes, loading }: IndexPanelProps) {
  const queryClient = useQueryClient()
  const [field, setField] = useState('')
  const [type, setType] = useState<IndexType>('string')
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const [justCreatedField, setJustCreatedField] = useState<string | undefined>(undefined)

  function invalidateIndexes(): void {
    void queryClient.invalidateQueries({ queryKey: ['json-indexes', domain] })
  }

  const createMutation = useMutation<CreateIndexOutcome, Error, { field: string; type: IndexType }>({
    mutationFn: (vars) => createIndex(apiClient, domain, vars.field, vars.type),
    onSuccess: (outcome) => {
      if (outcome.status !== 'ok') return
      invalidateIndexes()
      setField('')
      setJustCreatedField(outcome.index.field)
    },
  })

  const deleteMutation = useMutation<DeleteIndexOutcome, Error, string>({
    mutationFn: (deleteField) => deleteIndex(apiClient, domain, deleteField),
    onSuccess: (outcome) => {
      if (outcome.status === 'ok') invalidateIndexes()
    },
  })

  const reindexMutation = useMutation<StartReindexOutcome, Error, string>({
    mutationFn: (reindexField) => startReindex(apiClient, domain, reindexField),
    onSuccess: (outcome) => {
      if (outcome.status === 'ok') setJustCreatedField(undefined)
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const trimmed = field.trim()
    if (trimmed === '') {
      setFieldError('field must not be empty')
      return
    }
    setFieldError(undefined)
    createMutation.mutate({ field: trimmed, type })
  }

  const createErrorMessage = createMutation.data?.status === 'error' ? createMutation.data.message : undefined
  const deleteErrorMessage = deleteMutation.data?.status === 'error' ? deleteMutation.data.message : undefined
  const reindexErrorMessage = reindexMutation.data?.status === 'error' ? reindexMutation.data.message : undefined

  return (
    <div className="idx-panel">
      {loading ? (
        <div className="idx-panel__hint">loading…</div>
      ) : indexes.length === 0 ? (
        <div className="idx-panel__hint">no indexes yet</div>
      ) : (
        indexes.map((index) => (
          <div key={index.field} className="idx-panel__row">
            <span className="idx-panel__row-text mono-data">
              {index.field} · {index.type} · {formatIndexCreatedAt(index.created_at)}
            </span>
            <button
              type="button"
              className="idx-panel__delete"
              title="search on this field stops working"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(index.field)}
            >
              🗑
            </button>
          </div>
        ))
      )}
      {deleteErrorMessage !== undefined && <div className="idx-panel__error">{deleteErrorMessage}</div>}

      {justCreatedField !== undefined && (
        <div className="idx-panel__reindex-hint">
          existing documents are not back-indexed{' '}
          <button type="button" onClick={() => reindexMutation.mutate(justCreatedField)} disabled={reindexMutation.isPending}>
            reindex now
          </button>
        </div>
      )}
      {reindexErrorMessage !== undefined && <div className="idx-panel__error">{reindexErrorMessage}</div>}

      <form className="idx-panel__form" onSubmit={handleSubmit}>
        <input
          className="idx-panel__field-input"
          value={field}
          onChange={(event) => setField(event.target.value)}
          placeholder="field (e.g. address.city)"
          aria-label="index field"
          spellCheck={false}
        />
        <select className="idx-panel__type-select" aria-label="index type" value={type} onChange={(event) => setType(event.target.value as IndexType)}>
          {INDEX_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="submit" className="idx-panel__create" disabled={createMutation.isPending}>
          create index
        </button>
      </form>
      {fieldError !== undefined && <div className="idx-panel__error">{fieldError}</div>}
      {createErrorMessage !== undefined && <div className="idx-panel__error">{createErrorMessage}</div>}

      <div className="mono-path">
        GET {BASE_PATH}/json/{domain}/indexes
      </div>
    </div>
  )
}
