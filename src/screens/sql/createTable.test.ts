import { describe, expect, it } from 'vitest'
import { buildCreateTableSql, type ColumnDef, type TableDef } from './createTable'

function baseColumn(overrides: Partial<ColumnDef> & Pick<ColumnDef, 'name' | 'type'>): ColumnDef {
  return { primaryKey: false, autoincrement: false, notNull: false, unique: false, ...overrides }
}

describe('buildCreateTableSql', () => {
  it('matches the legacy boilerplate shape for a plain PK + TEXT column', () => {
    const def: TableDef = {
      name: 'table_name',
      columns: [
        baseColumn({ name: 'id', type: 'INTEGER', primaryKey: true }),
        baseColumn({ name: 'name', type: 'TEXT' }),
      ],
    }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE table_name (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);')
  })

  it('emits AUTOINCREMENT directly after PRIMARY KEY', () => {
    const def: TableDef = { name: 't', columns: [baseColumn({ name: 'id', type: 'INTEGER', primaryKey: true, autoincrement: true })] }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  id INTEGER PRIMARY KEY AUTOINCREMENT\n);')
  })

  it('never emits AUTOINCREMENT for a non-primary-key column even if the flag is set', () => {
    const def: TableDef = { name: 't', columns: [baseColumn({ name: 'n', type: 'INTEGER', autoincrement: true })] }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  n INTEGER\n);')
  })

  it('orders NOT NULL, UNIQUE, DEFAULT, REFERENCES after the type', () => {
    const def: TableDef = {
      name: 't',
      columns: [
        baseColumn({
          name: 'customer_id',
          type: 'INTEGER',
          notNull: true,
          unique: true,
          default: { kind: 'literal', text: '0' },
          references: 'customers',
        }),
      ],
    }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  customer_id INTEGER NOT NULL UNIQUE DEFAULT 0 REFERENCES customers\n);')
  })

  it('quotes TEXT defaults and escapes embedded single quotes by doubling them', () => {
    const def: TableDef = { name: 't', columns: [baseColumn({ name: 'nickname', type: 'TEXT', default: { kind: 'literal', text: "O'Brien" } })] }
    expect(buildCreateTableSql(def)).toBe("CREATE TABLE t (\n  nickname TEXT DEFAULT 'O''Brien'\n);")
  })

  it('passes INTEGER/REAL defaults through verbatim, including negative reals', () => {
    const def: TableDef = {
      name: 't',
      columns: [
        baseColumn({ name: 'count', type: 'INTEGER', default: { kind: 'literal', text: '0' } }),
        baseColumn({ name: 'balance', type: 'REAL', default: { kind: 'literal', text: '-3.5' } }),
      ],
    }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  count INTEGER DEFAULT 0,\n  balance REAL DEFAULT -3.5\n);')
  })

  it('uppercases BOOLEAN defaults regardless of input case', () => {
    const def: TableDef = {
      name: 't',
      columns: [
        baseColumn({ name: 'active', type: 'BOOLEAN', default: { kind: 'literal', text: 'true' } }),
        baseColumn({ name: 'archived', type: 'BOOLEAN', default: { kind: 'literal', text: 'false' } }),
      ],
    }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  active BOOLEAN DEFAULT TRUE,\n  archived BOOLEAN DEFAULT FALSE\n);')
  })

  it('quotes a literal TIMESTAMP default', () => {
    const def: TableDef = {
      name: 't',
      columns: [baseColumn({ name: 'seen_at', type: 'TIMESTAMP', default: { kind: 'literal', text: '2026-01-01T00:00:00Z' } })],
    }
    expect(buildCreateTableSql(def)).toBe("CREATE TABLE t (\n  seen_at TIMESTAMP DEFAULT '2026-01-01T00:00:00Z'\n);")
  })

  it('emits the bare CURRENT_TIMESTAMP keyword, unquoted', () => {
    const def: TableDef = { name: 't', columns: [baseColumn({ name: 'created_at', type: 'TIMESTAMP', default: { kind: 'currentTimestamp' } })] }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);')
  })

  it('joins multiple columns with a comma + newline, 2-space indent, and a trailing semicolon', () => {
    const def: TableDef = {
      name: 'orders',
      columns: [
        baseColumn({ name: 'id', type: 'INTEGER', primaryKey: true, autoincrement: true }),
        baseColumn({ name: 'customer_ref', type: 'KVREF' }),
        baseColumn({ name: 'total', type: 'REAL', notNull: true }),
      ],
    }
    expect(buildCreateTableSql(def)).toBe(
      'CREATE TABLE orders (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  customer_ref KVREF,\n  total REAL NOT NULL\n);',
    )
  })

  it('preserves column order exactly as given (no reordering)', () => {
    const def: TableDef = {
      name: 't',
      columns: [baseColumn({ name: 'z', type: 'TEXT' }), baseColumn({ name: 'a', type: 'TEXT', primaryKey: true })],
    }
    expect(buildCreateTableSql(def)).toBe('CREATE TABLE t (\n  z TEXT,\n  a TEXT PRIMARY KEY\n);')
  })
})
