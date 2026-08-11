import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { CodeEditor } from '../../lib'
import { relTableDetailQueryOptions, relTablesQueryOptions, relViewsQueryOptions } from '../../shell/domainDetails'
import type { DomainSummary } from '../../shell/domains'
import { openDocs } from '../docs/openDocs'
import './AlterTableModal.css'
import { buildAlterTableSql, type AddColumnDef, type AlterOperation } from './alterTable'
import { COLUMN_TYPES, type ColumnDefault, type ColumnType } from './createTable'
import { REF_HINTS, refEngineUnavailableReason, typeAllowsDefault, typeAllowsReferences } from './CreateTableModal'
import { sqlReadOnlyExtensions } from './editor'
import { identifierError } from './identifier'
import { addTab } from './sqlStore'

type ColumnInfo = components['schemas']['ColumnInfo']
type IndexInfo = components['schemas']['IndexInfo']
type TableDetail = components['schemas']['TableDetail']

type OpKind = 'add-column' | 'drop-column' | 'rename-column' | 'rename-table'

const OPERATIONS: [OpKind, string][] = [
  ['add-column', 'add column'],
  ['drop-column', 'drop column'],
  ['rename-column', 'rename column'],
  ['rename-table', 'rename table'],
]

/** PK-Spalte + indexierte Spalten (implizite `{t}_{c}_key`-Indexe stehen mit in schema.indexes) — spec sql/004 §4, Ausschluss über die column-Felder statt Namens-Parsing. */
function dropDisabledReason(column: ColumnInfo, indexes: IndexInfo[]): string | undefined {
  if (column.primary_key) return 'primary key'
  const index = indexes.find((entry) => entry.column === column.name)
  return index !== undefined ? `indexed by ${index.name}` : undefined
}

function firstDroppableColumn(columns: ColumnInfo[], indexes: IndexInfo[]): string {
  return columns.find((column) => dropDisabledReason(column, indexes) === undefined)?.name ?? ''
}

/** Leerer Literal-Wert wäre `DEFAULT ` (Syntaxfehler) bzw. `DEFAULT ''` auf TIMESTAMP (400) — nur TEXT darf leer sein (wie sql/002). */
function defaultValueError(type: ColumnType, enabled: boolean, currentTimestamp: boolean, text: string): string | undefined {
  if (!enabled || !typeAllowsDefault(type) || type === 'TEXT') return undefined
  if (type === 'TIMESTAMP' && currentTimestamp) return undefined
  return text.trim() === '' ? 'default value required' : undefined
}

/** NOT-NULL-Kopplung (spec sql/004 §3): nur mit literalem DEFAULT aktivierbar — CURRENT_TIMESTAMP zählt nicht als literal. */
function hasLiteralDefault(type: ColumnType, enabled: boolean, currentTimestamp: boolean, text: string): boolean {
  if (!enabled || !typeAllowsDefault(type) || (type === 'TIMESTAMP' && currentTimestamp)) return false
  return defaultValueError(type, enabled, currentTimestamp, text) === undefined
}

const NOT_NULL_LOCKED_REASON = 'not null needs a literal default value first (CURRENT_TIMESTAMP does not count as literal)'

interface AlterTableFormProps {
  domain: DomainSummary
  apiClient: ApiClient | undefined
  table: string
  schema: TableDetail
  onClose: () => void
}

/** Formular-Inhalt des Alter-Table-Assistenten (spec sql/004) — ohne <dialog>-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
export function AlterTableForm({ domain, apiClient, table, schema, onClose }: AlterTableFormProps) {
  const navigate = useNavigate()
  const enabled = apiClient !== undefined

  // Aktuelles Schema kommt als Prop (RelBrowser hat es schon geladen); andere Tabellen braucht nur REFERENCES (add column) und der Namensraum-Check (rename table).
  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain.name, enabled))
  const viewsQuery = useQuery(relViewsQueryOptions(apiClient, domain.name, enabled))
  const tables = tablesQuery.data ?? []
  const detailQueries = useQueries({
    queries: tables.map((entry) => relTableDetailQueryOptions(apiClient, domain.name, entry.name, enabled)),
  })
  const detailByTable = new Map(tables.map((entry, index) => [entry.name, detailQueries[index]?.data]))

  const [opKind, setOpKind] = useState<OpKind>('add-column')

  const [colName, setColName] = useState('')
  const [colType, setColType] = useState<ColumnType>('TEXT')
  const [notNull, setNotNull] = useState(false)
  const [defaultEnabled, setDefaultEnabled] = useState(false)
  const [defaultText, setDefaultText] = useState('')
  const [defaultCurrentTimestamp, setDefaultCurrentTimestamp] = useState(false)
  const [references, setReferences] = useState('')

  const [dropColumn, setDropColumn] = useState(() => firstDroppableColumn(schema.columns, schema.indexes))

  const [renameColumnFrom, setRenameColumnFrom] = useState(() => schema.columns[0]?.name ?? '')
  const [renameColumnTo, setRenameColumnTo] = useState('')

  const [renameTableTo, setRenameTableTo] = useState('')

  const defaultError = defaultValueError(colType, defaultEnabled, defaultCurrentTimestamp, defaultText)
  const notNullAllowed = hasLiteralDefault(colType, defaultEnabled, defaultCurrentTimestamp, defaultText)
  const effectiveNotNull = notNull && notNullAllowed
  const usingCurrentTimestamp = colType === 'TIMESTAMP' && defaultCurrentTimestamp

  // Bricht die Kopplung (DEFAULT deaktiviert/geleert/auf CURRENT_TIMESTAMP umgestellt), verwirft NOT NULL statt es nur unsichtbar zu sperren —
  // sonst würde ein späteres Wieder-Aktivieren des DEFAULT die Checkbox aus einem stillen `true` heraus überraschend wieder anhaken.
  useEffect(() => {
    if (!notNullAllowed) setNotNull(false)
  }, [notNullAllowed])

  function handleTypeChange(type: ColumnType): void {
    setColType(type)
    setNotNull(false)
    setDefaultEnabled(false)
    setDefaultText('')
    setDefaultCurrentTimestamp(false)
    setReferences('')
  }

  function targetsFor(type: ColumnType): string[] {
    if (!typeAllowsReferences(type)) return []
    return tables
      .map((entry) => entry.name)
      .filter((name) => {
        const pk = detailByTable.get(name)?.columns.find((column) => column.primary_key)
        return pk !== undefined && pk.type === type
      })
  }

  const colNameError =
    identifierError(colName) ?? (schema.columns.some((column) => column.name === colName) ? `duplicate column name "${colName}"` : undefined)

  function buildAddColumnDef(): AddColumnDef {
    const def: AddColumnDef = { name: colName, type: colType, notNull: effectiveNotNull }
    if (defaultEnabled && defaultError === undefined) {
      const value: ColumnDefault =
        colType === 'TIMESTAMP' && defaultCurrentTimestamp ? { kind: 'currentTimestamp' } : { kind: 'literal', text: defaultText }
      def.default = value
    }
    if (references !== '' && typeAllowsReferences(colType)) def.references = references
    return def
  }

  const noDroppableColumns = schema.columns.every((column) => dropDisabledReason(column, schema.indexes) !== undefined)
  const dropColumnInfo = schema.columns.find((column) => column.name === dropColumn)
  const dropColumnError = noDroppableColumns
    ? 'no column can be dropped — every column is the primary key or indexed'
    : (dropColumnInfo === undefined ? 'select a column' : dropDisabledReason(dropColumnInfo, schema.indexes))

  const existingColumnNames = new Set(schema.columns.map((column) => column.name))
  const renameColumnToError =
    identifierError(renameColumnTo) ??
    (renameColumnTo !== renameColumnFrom && existingColumnNames.has(renameColumnTo) ? `duplicate column name "${renameColumnTo}"` : undefined)

  const existingTableNames = new Set([...tables.map((entry) => entry.name), ...(viewsQuery.data ?? []).map((view) => view.name)])
  const renameTableToError =
    identifierError(renameTableTo) ??
    (renameTableTo !== table && existingTableNames.has(renameTableTo) ? `"${renameTableTo}" already exists (table or view)` : undefined)

  function currentOperation(): AlterOperation {
    if (opKind === 'add-column') return { kind: 'add-column', table, column: buildAddColumnDef() }
    if (opKind === 'drop-column') return { kind: 'drop-column', table, column: dropColumn }
    if (opKind === 'rename-column') return { kind: 'rename-column', table, from: renameColumnFrom, to: renameColumnTo }
    return { kind: 'rename-table', table, to: renameTableTo }
  }

  const canInsert =
    opKind === 'add-column'
      ? colNameError === undefined && defaultError === undefined
      : opKind === 'drop-column'
        ? dropColumnError === undefined
        : opKind === 'rename-column'
          ? renameColumnFrom !== '' && renameColumnToError === undefined
          : renameTableToError === undefined

  const previewSql = buildAlterTableSql(currentOperation())

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
      <div className="atm__head">
        <span id="atm-title" className="atm__title mono-label">
          alter table · {table}
        </span>
      </div>
      <div className="atm__body">
        <div className="atm__ops">
          {OPERATIONS.map(([kind, label]) => (
            <label key={kind} className="atm__op">
              <input type="radio" name="atm-op" checked={opKind === kind} onChange={() => setOpKind(kind)} /> {label}
            </label>
          ))}
        </div>

        {opKind === 'add-column' && (
          <div className="atm__section">
            <div className="atm__field">
              <label className="atm__label" htmlFor="atm-col-name">
                column name
              </label>
              <input
                id="atm-col-name"
                className="atm__input"
                value={colName}
                onChange={(event) => setColName(event.target.value.toLowerCase())}
                placeholder="column_name"
              />
              {colName !== '' && colNameError && <div className="atm__error">{colNameError}</div>}
            </div>

            <div className="atm__field">
              <label className="atm__label" htmlFor="atm-col-type">
                type
              </label>
              <select
                id="atm-col-type"
                className="atm__select"
                value={colType}
                onChange={(event) => handleTypeChange(event.target.value as ColumnType)}
              >
                {COLUMN_TYPES.map((type) => {
                  const reason = refEngineUnavailableReason(type, domain, 'ADD COLUMN')
                  return (
                    <option key={type} value={type} disabled={reason !== undefined} title={reason}>
                      {type}
                    </option>
                  )
                })}
              </select>
              {REF_HINTS[colType] && (
                <div className="atm__ref-hint">
                  {REF_HINTS[colType]}{' '}
                  <button type="button" className="atm__hint-link" onClick={goToLinkDocs}>
                    docs
                  </button>
                </div>
              )}
            </div>

            <div className="atm__flags">
              <label className="atm__flag">
                <input
                  type="checkbox"
                  aria-label="not null"
                  checked={effectiveNotNull}
                  disabled={!notNullAllowed}
                  title={notNullAllowed ? undefined : NOT_NULL_LOCKED_REASON}
                  onChange={(event) => setNotNull(event.target.checked)}
                />{' '}
                not null
              </label>
              <label className="atm__flag">
                <input
                  type="checkbox"
                  aria-label="default"
                  checked={defaultEnabled}
                  onChange={(event) => {
                    const value = event.target.checked
                    const initBoolean = value && colType === 'BOOLEAN' && defaultText === ''
                    setDefaultEnabled(value)
                    if (initBoolean) setDefaultText('true')
                  }}
                />{' '}
                default
              </label>
              {defaultEnabled && colType === 'TIMESTAMP' && (
                <label className="atm__flag">
                  <input
                    type="checkbox"
                    aria-label="default current_timestamp"
                    checked={defaultCurrentTimestamp}
                    onChange={(event) => setDefaultCurrentTimestamp(event.target.checked)}
                  />{' '}
                  CURRENT_TIMESTAMP
                </label>
              )}
              {defaultEnabled && !usingCurrentTimestamp && colType === 'BOOLEAN' && (
                <select aria-label="default value" value={defaultText} onChange={(event) => setDefaultText(event.target.value)}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              )}
              {defaultEnabled && !usingCurrentTimestamp && colType !== 'BOOLEAN' && (
                <input
                  className="atm__default-input"
                  aria-label="default value"
                  type={colType === 'INTEGER' || colType === 'REAL' ? 'number' : 'text'}
                  placeholder={colType === 'TIMESTAMP' ? 'YYYY-MM-DDThh:mm:ssZ' : undefined}
                  value={defaultText}
                  onChange={(event) => setDefaultText(event.target.value)}
                />
              )}
            </div>
            {defaultError && <div className="atm__error">{defaultError}</div>}

            {typeAllowsReferences(colType) && targetsFor(colType).length > 0 && (
              <div className="atm__field">
                <label className="atm__label" htmlFor="atm-col-references">
                  references
                </label>
                <select id="atm-col-references" className="atm__select" value={references} onChange={(event) => setReferences(event.target.value)}>
                  <option value="">—</option>
                  {targetsFor(colType).map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="atm__hint">
              no PRIMARY KEY, AUTOINCREMENT, or UNIQUE here — for a unique constraint, run CREATE UNIQUE INDEX after inserting this statement.
            </div>
          </div>
        )}

        {opKind === 'drop-column' && (
          <div className="atm__section">
            <div className="atm__field">
              <label className="atm__label" htmlFor="atm-drop-column">
                column to drop
              </label>
              <select id="atm-drop-column" className="atm__select" value={dropColumn} onChange={(event) => setDropColumn(event.target.value)}>
                {dropColumn === '' && <option value="">—</option>}
                {schema.columns.map((column) => {
                  const reason = dropDisabledReason(column, schema.indexes)
                  return (
                    <option key={column.name} value={column.name} disabled={reason !== undefined} title={reason}>
                      {column.name}
                    </option>
                  )
                })}
              </select>
            </div>
            {dropColumnError && <div className="atm__error">{dropColumnError}</div>}
            <div className="atm__hint">
              dropping a column can break views that depend on it — the server rejects with 409 (ViewDependencyConflict) at run time.
            </div>
          </div>
        )}

        {opKind === 'rename-column' && (
          <div className="atm__section">
            <div className="atm__field">
              <label className="atm__label" htmlFor="atm-rename-col-from">
                column to rename
              </label>
              <select
                id="atm-rename-col-from"
                className="atm__select"
                value={renameColumnFrom}
                onChange={(event) => setRenameColumnFrom(event.target.value)}
              >
                {schema.columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="atm__field">
              <label className="atm__label" htmlFor="atm-rename-col-to">
                new column name
              </label>
              <input
                id="atm-rename-col-to"
                className="atm__input"
                value={renameColumnTo}
                onChange={(event) => setRenameColumnTo(event.target.value.toLowerCase())}
                placeholder="new_column_name"
              />
              {renameColumnTo !== '' && renameColumnToError && <div className="atm__error">{renameColumnToError}</div>}
            </div>
          </div>
        )}

        {opKind === 'rename-table' && (
          <div className="atm__section">
            <div className="atm__field">
              <label className="atm__label" htmlFor="atm-rename-table-to">
                new table name
              </label>
              <input
                id="atm-rename-table-to"
                className="atm__input"
                value={renameTableTo}
                onChange={(event) => setRenameTableTo(event.target.value.toLowerCase())}
                placeholder="new_table_name"
              />
              {renameTableTo !== '' && renameTableToError && <div className="atm__error">{renameTableToError}</div>}
            </div>
            <div className="atm__hint">
              views that reference this table may keep the old name in their stored SQL — a broken dependency fails with 409 at run time.
            </div>
          </div>
        )}

        <div className="atm__preview">
          <span className="atm__preview-label mono-label">preview</span>
          <div className="atm__preview-editor">
            <CodeEditor value={previewSql} onChange={() => {}} extensions={sqlReadOnlyExtensions} ariaLabel="alter table preview" />
          </div>
        </div>
      </div>
      <div className="atm__footer">
        <button type="button" className="atm__cancel" onClick={onClose}>
          cancel
        </button>
        <button type="button" className="atm__insert" disabled={!canInsert} onClick={handleInsert}>
          insert into editor
        </button>
      </div>
    </>
  )
}

interface AlterTableModalProps {
  domain: DomainSummary
  apiClient: ApiClient | undefined
  table: string
  schema: TableDetail
  onClose: () => void
}

/** Alter-Table-Assistent (spec sql/004): natives `<dialog>` + `showModal()` um `AlterTableForm`, gleiche Mechanik wie CreateTableModal (sql/002). */
export function AlterTableModal({ domain, apiClient, table, schema, onClose }: AlterTableModalProps) {
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
    <dialog ref={dialogRef} className="atm" aria-labelledby="atm-title">
      <AlterTableForm domain={domain} apiClient={apiClient} table={table} schema={schema} onClose={onClose} />
    </dialog>
  )
}
