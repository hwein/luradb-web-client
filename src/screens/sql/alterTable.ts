import { columnClause, type ColumnDef, type ColumnDefault, type ColumnType } from './createTable'

/** ADD COLUMN definition: no PRIMARY KEY/AUTOINCREMENT/UNIQUE (a v1 server restriction). */
export interface AddColumnDef {
  name: string
  type: ColumnType
  /** The caller must ensure NOT NULL only comes with a literal DEFAULT; the generator only formats. */
  notNull: boolean
  default?: ColumnDefault
  references?: string
}

export type AlterOperation =
  | { kind: 'add-column'; table: string; column: AddColumnDef }
  | { kind: 'drop-column'; table: string; column: string }
  | { kind: 'rename-column'; table: string; from: string; to: string }
  | { kind: 'rename-table'; table: string; to: string }

function toColumnDef(column: AddColumnDef): ColumnDef {
  const def: ColumnDef = {
    name: column.name,
    type: column.type,
    primaryKey: false,
    autoincrement: false,
    notNull: column.notNull,
    unique: false,
  }
  if (column.default !== undefined) def.default = column.default
  if (column.references !== undefined) def.references = column.references
  return def
}

/** One statement per call (the server runs one statement per request); same format rules/escaping as buildCreateTableSql (reuses columnClause). */
export function buildAlterTableSql(op: AlterOperation): string {
  switch (op.kind) {
    case 'add-column':
      return `ALTER TABLE ${op.table} ADD COLUMN ${columnClause(toColumnDef(op.column))};`
    case 'drop-column':
      return `ALTER TABLE ${op.table} DROP COLUMN ${op.column};`
    case 'rename-column':
      return `ALTER TABLE ${op.table} RENAME COLUMN ${op.from} TO ${op.to};`
    case 'rename-table':
      return `ALTER TABLE ${op.table} RENAME TO ${op.to};`
  }
}
