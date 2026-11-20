/** The 7 canonical column types; no aliases in the generator/modal. */
export type ColumnType = 'INTEGER' | 'REAL' | 'TEXT' | 'BOOLEAN' | 'TIMESTAMP' | 'KVREF' | 'JSONREF'

export const COLUMN_TYPES: readonly ColumnType[] = ['INTEGER', 'REAL', 'TEXT', 'BOOLEAN', 'TIMESTAMP', 'KVREF', 'JSONREF']

export type ColumnDefault = { kind: 'literal'; text: string } | { kind: 'currentTimestamp' }

export interface ColumnDef {
  name: string
  type: ColumnType
  primaryKey: boolean
  autoincrement: boolean
  notNull: boolean
  unique: boolean
  default?: ColumnDefault
  references?: string
}

export interface TableDef {
  name: string
  columns: ColumnDef[]
}

function quoteLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

function formatDefaultValue(type: ColumnType, value: ColumnDefault): string {
  if (value.kind === 'currentTimestamp') return 'CURRENT_TIMESTAMP'
  if (type === 'BOOLEAN') return value.text.toUpperCase()
  if (type === 'INTEGER' || type === 'REAL') return value.text
  return quoteLiteral(value.text)
}

/** Exported for the alter-table generator; same constraint order/escaping for ADD COLUMN. */
export function columnClause(column: ColumnDef): string {
  const parts = [column.name, column.type]
  if (column.primaryKey) {
    parts.push('PRIMARY KEY')
    if (column.autoincrement) parts.push('AUTOINCREMENT')
  }
  if (column.notNull) parts.push('NOT NULL')
  if (column.unique) parts.push('UNIQUE')
  if (column.default) parts.push(`DEFAULT ${formatDefaultValue(column.type, column.default)}`)
  if (column.references !== undefined) parts.push(`REFERENCES ${column.references}`)
  return parts.join(' ')
}

/** Pure formatting: order PRIMARY KEY [AUTOINCREMENT] → NOT NULL → UNIQUE → DEFAULT → REFERENCES, 2-space indent, no comment. Rule validation is the modal's job. */
export function buildCreateTableSql(def: TableDef): string {
  const lines = def.columns.map((column) => `  ${columnClause(column)}`)
  return `CREATE TABLE ${def.name} (\n${lines.join(',\n')}\n);`
}
