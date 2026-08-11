import { columnClause, type ColumnDef, type ColumnDefault, type ColumnType } from './createTable'

/** ADD-COLUMN-Definition (spec sql/004 §3) — kein PRIMARY KEY/AUTOINCREMENT/UNIQUE (v1-Einschränkung des Servers). */
export interface AddColumnDef {
  name: string
  type: ColumnType
  /** Aufrufer muss die NOT-NULL-Kopplung (§3: nur mit literalem DEFAULT) sicherstellen — der Generator formatiert nur. */
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

/** Ein Statement pro Aufruf (api/LURASQL.md „Ein Statement pro Request“) — Formatregeln/Escaping wie buildCreateTableSql (columnClause wiederverwendet). */
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
