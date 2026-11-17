import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, type ApiClient } from '../../api'
import { CallLine } from '../../lib/CallLine'
import { relTablesKey, relTablesQueryOptions, relViewsQueryOptions } from '../../shell/domainDetails'
import { identifierError } from '../sql/identifier'
import './RelFileImportModal.css'
import {
  fileImportPath,
  formatFromFileName,
  pkCandidates,
  runFileImport,
  tableNameFromFileName,
  type FileFormat,
  type FileImportOptions,
} from './relFileImport'

const FORMATS: FileFormat[] = ['csv', 'tsv']

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface RelFileImportProps {
  domain: string
  apiClient: ApiClient | undefined
  onClose: () => void
}

/** Form of the file-import dialog (spec s-55d9034e) — without the <dialog> shell, so tests can mount it without `showModal()`. */
export function RelFileImportForm({ domain, apiClient, onClose }: RelFileImportProps) {
  const enabled = apiClient !== undefined
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain, enabled))
  const viewsQuery = useQuery(relViewsQueryOptions(apiClient, domain, enabled))

  const [file, setFile] = useState<{ name: string; size: number } | undefined>(undefined)
  // undefined while the chosen file is being read or its read failed
  const [text, setText] = useState<string | undefined>('')
  const [readFailed, setReadFailed] = useState(false)
  const readerRef = useRef<FileReader | undefined>(undefined)
  const [format, setFormat] = useState<FileFormat>('csv')
  const [tableName, setTableName] = useState('')
  const [header, setHeader] = useState(true)
  const [pk, setPk] = useState('')

  const candidates = useMemo(() => pkCandidates(text ?? '', format, header), [text, format, header])
  const effectivePk = candidates.some((candidate) => candidate.name === pk) ? pk : ''

  // Invalidation lives in the mutation options so it still runs when the dialog is closed while sending.
  const mutation = useMutation({
    mutationFn: (options: FileImportOptions) => {
      if (!apiClient) throw new Error('file import requires an active connection')
      return runFileImport(apiClient, domain, options)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: relTablesKey(domain) }),
  })
  const pending = mutation.isPending
  const result = mutation.data

  const existingNames = new Set([...(tablesQuery.data ?? []).map((table) => table.name), ...(viewsQuery.data ?? []).map((view) => view.name)])
  // The table just created from this dialog is not a collision (F7), but it cannot be imported again either.
  const justCreated = result !== undefined && tableName === result.table
  const tableNameError =
    identifierError(tableName) ?? (existingNames.has(tableName) && !justCreated ? `"${tableName}" already exists (table or view)` : undefined)
  const canImport = file !== undefined && text !== undefined && tableNameError === undefined && !justCreated && !pending

  function startImport(): void {
    if (text === undefined) return
    mutation.mutate({ text, name: tableName, format, header, pk: effectivePk === '' ? undefined : effectivePk })
  }

  function openTable(table: string): void {
    void navigate(`/data?engine=rel&table=${encodeURIComponent(table)}`)
    onClose()
  }

  // Persist a fallen-back choice before the candidates change again, so a dropped key does not return later.
  function commitPk(): void {
    setPk(effectivePk)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (chosen === undefined) return
    commitPk()
    setFile({ name: chosen.name, size: chosen.size })
    setFormat(formatFromFileName(chosen.name))
    setTableName(tableNameFromFileName(chosen.name))
    setText(undefined)
    setReadFailed(false)
    readerRef.current?.abort()
    const reader = new FileReader()
    readerRef.current = reader
    reader.onload = () => {
      if (readerRef.current === reader && typeof reader.result === 'string') setText(reader.result)
    }
    reader.onerror = () => {
      if (readerRef.current === reader) setReadFailed(true)
    }
    reader.readAsText(chosen)
  }

  return (
    <>
      <div className="rfi__head">
        <span id="rfi-title" className="rfi__title mono-label">
          create table from file · {domain}
        </span>
      </div>
      <div className="rfi__body">
        <div className="rfi__input-row">
          <label className="rfi__file">
            choose file…
            <input className="rfi__file-input" type="file" accept=".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values,text/plain" onChange={handleFile} disabled={pending} />
          </label>
          {file && (
            <span className="rfi__file-info">
              {file.name} · {formatSize(file.size)}
            </span>
          )}
        </div>
        {readFailed && <div className="rfi__error">could not read the file — choose it again</div>}
        <div className="rfi__field">
          <span className="rfi__label">format</span>
          <div className="rfi__segments" role="group" aria-label="format">
            {FORMATS.map((option) => (
              <button
                key={option}
                type="button"
                className={`rfi__segment${format === option ? ' rfi__segment--active' : ''}`}
                aria-pressed={format === option}
                disabled={pending}
                onClick={() => {
                  commitPk()
                  setFormat(option)
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="rfi__field">
          <label className="rfi__label" htmlFor="rfi-name">
            table name
          </label>
          <input
            id="rfi-name"
            className="rfi__name"
            value={tableName}
            onChange={(event) => setTableName(event.target.value.toLowerCase())}
            placeholder="table_name"
            disabled={pending}
          />
          {tableName !== '' && tableNameError && <div className="rfi__error">{tableNameError}</div>}
        </div>
        <div className="rfi__field">
          <label className="rfi__flag">
            <input
              type="checkbox"
              checked={header}
              disabled={pending}
              onChange={(event) => {
                commitPk()
                setHeader(event.target.checked)
              }}
            />{' '}
            first line is a header
          </label>
          {!header && <div className="rfi__hint">columns become col_1 … col_n and the first line is imported as data</div>}
        </div>
        <div className="rfi__field">
          <label className="rfi__label" htmlFor="rfi-pk">
            primary key
          </label>
          <select id="rfi-pk" className="rfi__select" value={effectivePk} disabled={pending} onChange={(event) => setPk(event.target.value)}>
            <option value="">(none — the server adds an integer column _row)</option>
            {candidates.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.source === candidate.name ? candidate.name : `${candidate.name} ← ${candidate.source}`}
              </option>
            ))}
          </select>
          {effectivePk === '' && <div className="rfi__hint">_row is not autoincrement — later row inserts must supply it</div>}
        </div>
        <div className="rfi__hint">excel/ods? save it as csv in your spreadsheet app first</div>
        {text?.includes('�') && (
          <div className="rfi__warn">not valid utf-8 — characters were replaced; save the file as utf-8 and retry</div>
        )}
        {mutation.error && (
          <>
            <div className="rfi__error">{mutation.error.message}</div>
            {mutation.error instanceof ApiError && mutation.error.status === 413 && (
              <div className="rfi__hint">the server limits the request body (~64 MiB measured) — split the file or import it with the cli</div>
            )}
          </>
        )}
        {result && (
          <div className="rfi__result">
            <div className="rfi__created">table {result.table} created</div>
            <div className="rfi__summary">
              imported {result.imported} ·{' '}
              <span className={result.failed > 0 ? 'rfi__summary-failed' : undefined}>failed {result.failed}</span>
            </div>
            <div className="rfi__cols">
              {result.columns.map((column) => (
                <span key={column.name} className="rfi__col-chip">
                  {column.primary_key && (
                    <span className="rfi__col-chip-pk" aria-hidden="true">
                      ●
                    </span>
                  )}
                  {column.name}·{column.type}
                  {typeof column.source_header === 'string' && column.source_header !== column.name && (
                    <span className="rfi__col-chip-src"> ← {column.source_header}</span>
                  )}
                </span>
              ))}
            </div>
            {result.errors.length > 0 && (
              <ul className="rfi__errors">
                {result.errors.map((entry, index) => (
                  <li key={index}>
                    row {entry.row} · {entry.error}
                  </li>
                ))}
              </ul>
            )}
            {result.imported === 0 && result.failed > 0 && (
              <div className="rfi__warn">the table was created and is empty — drop it in the sql console if the file was wrong</div>
            )}
            {mutation.variables && <CallLine method="POST" path={fileImportPath(domain, mutation.variables)} />}
            <button type="button" className="rfi__open" onClick={() => openTable(result.table)}>
              open table →
            </button>
          </div>
        )}
      </div>
      <div className="rfi__footer">
        <button type="button" className="rfi__close" onClick={onClose}>
          close
        </button>
        <button type="button" className="rfi__import" disabled={!canImport} onClick={startImport}>
          {pending ? 'importing…' : 'import'}
        </button>
      </div>
    </>
  )
}

/** File-import dialog (spec s-55d9034e): native `<dialog>` + `showModal()` around `RelFileImportForm`. */
export function RelFileImportModal({ domain, apiClient, onClose }: RelFileImportProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // `open` guard: the StrictMode second run hits an already open dialog, and showModal() would throw
    // before the close listener is registered.
    if (!dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLInputElement>('input[type="file"]')?.focus()
    }
    function handleClose(): void {
      onCloseRef.current()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog ref={dialogRef} className="rfi" aria-labelledby="rfi-title">
      <RelFileImportForm domain={domain} apiClient={apiClient} onClose={onClose} />
    </dialog>
  )
}
