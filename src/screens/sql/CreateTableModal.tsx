import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import { CodeEditor } from '../../lib'
import { relTableDetailQueryOptions, relTablesQueryOptions, relViewsQueryOptions } from '../../shell/domainDetails'
import type { DomainSummary } from '../../shell/domains'
import { openDocs } from '../docs/openDocs'
import './CreateTableModal.css'
import { buildCreateTableSql, COLUMN_TYPES, type ColumnDef, type ColumnDefault, type ColumnType, type TableDef } from './createTable'
import { sqlReadOnlyExtensions } from './editor'
import { identifierError } from './identifier'
import { addTab } from './sqlStore'

interface ColumnDraft {
  key: string
  name: string
  type: ColumnType
  notNull: boolean
  unique: boolean
  autoincrement: boolean
  defaultEnabled: boolean
  defaultText: string
  defaultCurrentTimestamp: boolean
  references: string
}

function seedColumn(): ColumnDraft {
  return {
    key: 'col-0',
    name: 'id',
    type: 'INTEGER',
    notNull: false,
    unique: false,
    autoincrement: false,
    defaultEnabled: false,
    defaultText: '',
    defaultCurrentTimestamp: false,
    references: '',
  }
}

function blankColumn(key: string): ColumnDraft {
  return {
    key,
    name: '',
    type: 'TEXT',
    notNull: false,
    unique: false,
    autoincrement: false,
    defaultEnabled: false,
    defaultText: '',
    defaultCurrentTimestamp: false,
    references: '',
  }
}

function isPkEligibleType(type: ColumnType): boolean {
  return type === 'INTEGER' || type === 'TEXT'
}

/** Exportiert für den ALTER-TABLE-Assistenten (spec sql/004 §3) — dieselbe Typ-Eignung gilt für ADD COLUMN. */
export function typeAllowsDefault(type: ColumnType): boolean {
  return type !== 'KVREF' && type !== 'JSONREF'
}

export function typeAllowsReferences(type: ColumnType): boolean {
  return type === 'INTEGER' || type === 'TEXT'
}

const PK_TYPE_ERROR = 'primary key must be INTEGER or TEXT — change the type or pick a different primary key'

/** Exportiert für sql/004 (add column) — Hinweistext ist statement-unabhängig (beschreibt das Insert-Verhalten der Spalte). */
export const REF_HINTS: Partial<Record<ColumnType, string>> = {
  KVREF: 'points to a kv key in this domain — insert validates it exists (409 if missing).',
  JSONREF: 'points to a json document key in this domain — insert validates it exists (409 if missing).',
}

/**
 * Fehlt die Ziel-Engine der Domäne oder ist sie deleting, würde das Statement mit 409 scheitern (spec sql/002 §5,
 * wiederverwendet von sql/004 §3 für ADD COLUMN) — Option deaktiviert, Grund im title. `statement` benennt das
 * scheiternde Statement in der Begründung (`CREATE` bzw. `ADD COLUMN`).
 */
export function refEngineUnavailableReason(type: ColumnType, domain: DomainSummary, statement: string): string | undefined {
  if (type === 'KVREF') {
    return domain.engines.kv === undefined ? `kv engine not enabled for this domain — ${statement} would fail with 409` : undefined
  }
  if (type === 'JSONREF') {
    const json = domain.engines.json
    if (json === undefined) return `json engine not enabled for this domain — ${statement} would fail with 409`
    if (json.state === 'deleting') return `json engine is deleting in this domain — ${statement} would fail with 409`
    return undefined
  }
  return undefined
}

function toDefaultDef(column: ColumnDraft): ColumnDefault | undefined {
  if (!column.defaultEnabled || !typeAllowsDefault(column.type)) return undefined
  if (column.type === 'TIMESTAMP' && column.defaultCurrentTimestamp) return { kind: 'currentTimestamp' }
  return { kind: 'literal', text: column.defaultText }
}

/** Leerer Literal-Wert wäre `DEFAULT ` (Syntaxfehler) bzw. `DEFAULT ''` auf TIMESTAMP (400) — nur TEXT darf leer sein. */
function columnDefaultError(column: ColumnDraft): string | undefined {
  if (!column.defaultEnabled || !typeAllowsDefault(column.type) || column.type === 'TEXT') return undefined
  if (column.type === 'TIMESTAMP' && column.defaultCurrentTimestamp) return undefined
  return column.defaultText.trim() === '' ? 'default value required' : undefined
}

function toColumnDef(column: ColumnDraft, isPk: boolean): ColumnDef {
  const def: ColumnDef = {
    name: column.name,
    type: column.type,
    primaryKey: isPk,
    autoincrement: isPk && column.type === 'INTEGER' && column.autoincrement,
    notNull: !isPk && column.notNull,
    unique: !isPk && column.unique,
  }
  if (!isPk) {
    const defaultDef = toDefaultDef(column)
    if (defaultDef !== undefined) def.default = defaultDef
    if (column.references !== '' && typeAllowsReferences(column.type)) def.references = column.references
  }
  return def
}

function DefaultControl({ column, index, onChange }: { column: ColumnDraft; index: number; onChange: (patch: Partial<ColumnDraft>) => void }) {
  const isTimestamp = column.type === 'TIMESTAMP'
  const usingCurrentTimestamp = isTimestamp && column.defaultCurrentTimestamp

  return (
    <span className="ctm__default">
      <label className="ctm__flag">
        <input
          type="checkbox"
          aria-label={`default for column ${index + 1}`}
          checked={column.defaultEnabled}
          onChange={(event) => {
            const enabled = event.target.checked
            // BOOLEAN zeigt sonst "true" an, ohne dass defaultText das je gesetzt hätte — leere Vorschau-DEFAULT-Klausel.
            const initBoolean = enabled && column.type === 'BOOLEAN' && column.defaultText === ''
            onChange(initBoolean ? { defaultEnabled: enabled, defaultText: 'true' } : { defaultEnabled: enabled })
          }}
        />{' '}
        default
      </label>
      {column.defaultEnabled && isTimestamp && (
        <label className="ctm__flag">
          <input
            type="checkbox"
            aria-label={`default current_timestamp for column ${index + 1}`}
            checked={column.defaultCurrentTimestamp}
            onChange={(event) => onChange({ defaultCurrentTimestamp: event.target.checked })}
          />{' '}
          CURRENT_TIMESTAMP
        </label>
      )}
      {column.defaultEnabled && !usingCurrentTimestamp && column.type === 'BOOLEAN' && (
        <select
          aria-label={`default value for column ${index + 1}`}
          value={column.defaultText}
          onChange={(event) => onChange({ defaultText: event.target.value })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )}
      {column.defaultEnabled && !usingCurrentTimestamp && column.type !== 'BOOLEAN' && (
        <input
          className="ctm__default-input"
          aria-label={`default value for column ${index + 1}`}
          type={column.type === 'INTEGER' || column.type === 'REAL' ? 'number' : 'text'}
          placeholder={isTimestamp ? 'YYYY-MM-DDThh:mm:ssZ' : undefined}
          value={column.defaultText}
          onChange={(event) => onChange({ defaultText: event.target.value })}
        />
      )}
    </span>
  )
}

interface ColumnRowProps {
  column: ColumnDraft
  index: number
  isPk: boolean
  showPkTypeError: boolean
  domain: DomainSummary
  targets: string[]
  nameError: string | undefined
  removeDisabled: boolean
  onSelectPk: () => void
  onChangeType: (type: ColumnType) => void
  onChange: (patch: Partial<ColumnDraft>) => void
  onRemove: () => void
  onOpenLinkDocs: () => void
}

function ColumnRow({
  column,
  index,
  isPk,
  showPkTypeError,
  domain,
  targets,
  nameError,
  removeDisabled,
  onSelectPk,
  onChangeType,
  onChange,
  onRemove,
  onOpenLinkDocs,
}: ColumnRowProps) {
  const pkEligible = isPkEligibleType(column.type)
  const refHint = REF_HINTS[column.type]
  const defaultError = isPk ? undefined : columnDefaultError(column)

  return (
    <div className="ctm__row">
      <div className="ctm__row-main">
        <input
          className="ctm__row-name"
          aria-label={`column ${index + 1} name`}
          value={column.name}
          onChange={(event) => onChange({ name: event.target.value.toLowerCase() })}
          placeholder="column_name"
        />
        <select
          className="ctm__row-type"
          aria-label={`column ${index + 1} type`}
          value={column.type}
          onChange={(event) => onChangeType(event.target.value as ColumnType)}
        >
          {COLUMN_TYPES.map((type) => {
            const reason = refEngineUnavailableReason(type, domain, 'CREATE')
            return (
              <option key={type} value={type} disabled={reason !== undefined} title={reason}>
                {type}
              </option>
            )
          })}
        </select>
        <label className="ctm__row-pk">
          <input type="radio" name="ctm-pk" aria-label={`primary key: column ${index + 1}`} checked={isPk} disabled={!pkEligible} onChange={onSelectPk} />{' '}
          pk
        </label>
        <button
          type="button"
          className="ctm__row-remove"
          aria-label={`remove column ${index + 1}`}
          disabled={removeDisabled}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <div className="ctm__row-flags">
        <label className={isPk ? 'ctm__flag ctm__flag--implicit' : 'ctm__flag'}>
          <input
            type="checkbox"
            aria-label={`not null for column ${index + 1}`}
            checked={isPk || column.notNull}
            disabled={isPk}
            onChange={(event) => onChange({ notNull: event.target.checked })}
          />{' '}
          not null
        </label>
        <label className={isPk ? 'ctm__flag ctm__flag--implicit' : 'ctm__flag'}>
          <input
            type="checkbox"
            aria-label={`unique for column ${index + 1}`}
            checked={isPk || column.unique}
            disabled={isPk}
            onChange={(event) => onChange({ unique: event.target.checked })}
          />{' '}
          unique
        </label>
        {isPk && (
          <label className="ctm__flag">
            <input
              type="checkbox"
              aria-label={`autoincrement for column ${index + 1}`}
              checked={column.autoincrement}
              disabled={column.type !== 'INTEGER'}
              onChange={(event) => onChange({ autoincrement: event.target.checked })}
            />{' '}
            autoincrement
          </label>
        )}
        {!isPk && typeAllowsDefault(column.type) && <DefaultControl column={column} index={index} onChange={onChange} />}
        {!isPk && typeAllowsReferences(column.type) && targets.length > 0 && (
          <label className="ctm__flag">
            references{' '}
            <select
              aria-label={`references for column ${index + 1}`}
              value={column.references}
              onChange={(event) => onChange({ references: event.target.value })}
            >
              <option value="">—</option>
              {targets.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {nameError && <div className="ctm__row-error">{nameError}</div>}
      {defaultError && <div className="ctm__row-error">{defaultError}</div>}
      {showPkTypeError && <div className="ctm__row-error">{PK_TYPE_ERROR}</div>}
      {refHint && (
        <div className="ctm__hint">
          {refHint}{' '}
          <button type="button" className="ctm__hint-link" onClick={onOpenLinkDocs}>
            docs
          </button>
        </div>
      )}
    </div>
  )
}

interface CreateTableFormProps {
  domain: DomainSummary
  apiClient: ApiClient | undefined
  onClose: () => void
}

/** Formular-Inhalt des Create-Table-Assistenten (spec sql/002) — ohne <dialog>-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
export function CreateTableForm({ domain, apiClient, onClose }: CreateTableFormProps) {
  const navigate = useNavigate()
  const enabled = apiClient !== undefined

  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain.name, enabled))
  const viewsQuery = useQuery(relViewsQueryOptions(apiClient, domain.name, enabled))
  const tables = tablesQuery.data ?? []
  const detailQueries = useQueries({
    queries: tables.map((table) => relTableDetailQueryOptions(apiClient, domain.name, table.name, enabled)),
  })

  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState<ColumnDraft[]>(() => [seedColumn()])
  const [pkKey, setPkKey] = useState('col-0')
  const nextKeyRef = useRef(1)

  const existingNames = new Set([...tables.map((table) => table.name), ...(viewsQuery.data ?? []).map((view) => view.name)])
  const tableNameError = identifierError(tableName) ?? (existingNames.has(tableName) ? `"${tableName}" already exists (table or view)` : undefined)

  const pkColumn = columns.find((column) => column.key === pkKey)
  const pkTypeError = pkColumn !== undefined && !isPkEligibleType(pkColumn.type)

  const detailByTable = new Map(tables.map((table, index) => [table.name, detailQueries[index]?.data]))

  function targetsFor(type: ColumnType): string[] {
    if (!typeAllowsReferences(type)) return []
    return tables
      .map((table) => table.name)
      .filter((name) => {
        const pk = detailByTable.get(name)?.columns.find((column) => column.primary_key)
        return pk !== undefined && pk.type === type
      })
  }

  function columnNameError(column: ColumnDraft): string | undefined {
    const basic = identifierError(column.name)
    if (basic !== undefined) return basic
    const duplicate = columns.filter((other) => other.name === column.name).length > 1
    return duplicate ? `duplicate column name "${column.name}"` : undefined
  }

  const hasColumnErrors = columns.some(
    (column) => columnNameError(column) !== undefined || (column.key !== pkKey && columnDefaultError(column) !== undefined),
  )
  const canInsert = tableNameError === undefined && !hasColumnErrors && !pkTypeError

  const tableDef: TableDef = {
    name: tableName,
    columns: columns.map((column) => toColumnDef(column, column.key === pkKey)),
  }
  const previewSql = buildCreateTableSql(tableDef)

  function updateColumn(key: string, patch: Partial<ColumnDraft>): void {
    setColumns((cols) => cols.map((column) => (column.key === key ? { ...column, ...patch } : column)))
  }

  function updateColumnType(key: string, type: ColumnType): void {
    setColumns((cols) =>
      cols.map((column) =>
        column.key === key
          ? { ...column, type, autoincrement: false, defaultEnabled: false, defaultText: '', defaultCurrentTimestamp: false, references: '' }
          : column,
      ),
    )
  }

  function addColumn(): void {
    const key = `col-${nextKeyRef.current}`
    nextKeyRef.current += 1
    setColumns((cols) => [...cols, blankColumn(key)])
  }

  function removeColumn(key: string): void {
    const remaining = columns.filter((column) => column.key !== key)
    setColumns(remaining)
    if (pkKey === key) {
      const first = remaining[0]
      if (first !== undefined) setPkKey(first.key)
    }
  }

  function goToLinkDocs(): void {
    openDocs('cross-engine-links')
    void navigate('/docs')
  }

  function handleInsert(): void {
    if (!canInsert) return
    addTab(previewSql)
    void navigate('/sql')
    onClose()
  }

  return (
    <>
      <div className="ctm__head">
        <span id="ctm-title" className="ctm__title mono-label">
          create table · {domain.name}
        </span>
      </div>
      <div className="ctm__body">
        <div className="ctm__field">
          <label className="ctm__label" htmlFor="ctm-name">
            table name
          </label>
          <input
            id="ctm-name"
            className="ctm__name"
            value={tableName}
            onChange={(event) => setTableName(event.target.value.toLowerCase())}
            placeholder="table_name"
          />
          {tableName !== '' && tableNameError && <div className="ctm__error">{tableNameError}</div>}
        </div>

        <div className="ctm__columns">
          {columns.map((column, index) => (
            <ColumnRow
              key={column.key}
              column={column}
              index={index}
              isPk={column.key === pkKey}
              showPkTypeError={column.key === pkKey && pkTypeError}
              domain={domain}
              targets={targetsFor(column.type)}
              nameError={column.name !== '' ? columnNameError(column) : undefined}
              removeDisabled={columns.length === 1}
              onSelectPk={() => setPkKey(column.key)}
              onChangeType={(type) => updateColumnType(column.key, type)}
              onChange={(patch) => updateColumn(column.key, patch)}
              onRemove={() => removeColumn(column.key)}
              onOpenLinkDocs={goToLinkDocs}
            />
          ))}
          <button type="button" className="ctm__add-column" onClick={addColumn}>
            + add column
          </button>
        </div>

        <div className="ctm__preview">
          <span className="ctm__preview-label mono-label">preview</span>
          <div className="ctm__preview-editor">
            <CodeEditor value={previewSql} onChange={() => {}} extensions={sqlReadOnlyExtensions} ariaLabel="create table preview" />
          </div>
        </div>
      </div>
      <div className="ctm__footer">
        <button type="button" className="ctm__cancel" onClick={onClose}>
          cancel
        </button>
        <button type="button" className="ctm__insert" disabled={!canInsert} onClick={handleInsert}>
          insert into editor
        </button>
      </div>
    </>
  )
}

interface CreateTableModalProps {
  domain: DomainSummary
  apiClient: ApiClient | undefined
  onClose: () => void
}

/** Create-Table-Assistent (spec sql/002): natives `<dialog>` + `showModal()` (ESC/Fokus-Trap nativ) um `CreateTableForm`. */
export function CreateTableModal({ domain, apiClient, onClose }: CreateTableModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // `open`-Guard: der StrictMode-Zweitlauf trifft einen bereits offenen Dialog — showModal() würfe dann,
    // bevor der close-Listener registriert ist (ESC bliebe wirkungslos).
    if (!dialog.open) {
      dialog.showModal()
      dialog.querySelector('input')?.focus()
    }
    function handleClose(): void {
      onCloseRef.current()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog ref={dialogRef} className="ctm" aria-labelledby="ctm-title">
      <CreateTableForm domain={domain} apiClient={apiClient} onClose={onClose} />
    </dialog>
  )
}
