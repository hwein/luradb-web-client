import { describe, expect, it } from 'vitest'
import { buildAlterTableSql, type AlterOperation } from './alterTable'

describe('buildAlterTableSql', () => {
  it('add column: bare column with no constraints', () => {
    const op: AlterOperation = { kind: 'add-column', table: 'orders', column: { name: 'note', type: 'TEXT', notNull: false } }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders ADD COLUMN note TEXT;')
  })

  it('add column: NOT NULL paired with a literal DEFAULT', () => {
    const op: AlterOperation = {
      kind: 'add-column',
      table: 'orders',
      column: { name: 'total', type: 'REAL', notNull: true, default: { kind: 'literal', text: '0' } },
    }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders ADD COLUMN total REAL NOT NULL DEFAULT 0;')
  })

  it('add column: DEFAULT CURRENT_TIMESTAMP on a TIMESTAMP column', () => {
    const op: AlterOperation = {
      kind: 'add-column',
      table: 'orders',
      column: { name: 'created_at', type: 'TIMESTAMP', notNull: false, default: { kind: 'currentTimestamp' } },
    }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;')
  })

  it('add column: REFERENCES an existing table', () => {
    const op: AlterOperation = {
      kind: 'add-column',
      table: 'orders',
      column: { name: 'warehouse_id', type: 'INTEGER', notNull: false, references: 'warehouses' },
    }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders ADD COLUMN warehouse_id INTEGER REFERENCES warehouses;')
  })

  it('add column: escapes a single quote in a TEXT literal default', () => {
    const op: AlterOperation = {
      kind: 'add-column',
      table: 'orders',
      column: { name: 'status', type: 'TEXT', notNull: false, default: { kind: 'literal', text: "it's pending" } },
    }
    expect(buildAlterTableSql(op)).toBe("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'it''s pending';")
  })

  it('add column: BOOLEAN default renders uppercase TRUE', () => {
    const op: AlterOperation = {
      kind: 'add-column',
      table: 'orders',
      column: { name: 'active', type: 'BOOLEAN', notNull: false, default: { kind: 'literal', text: 'true' } },
    }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders ADD COLUMN active BOOLEAN DEFAULT TRUE;')
  })

  it('drop column', () => {
    const op: AlterOperation = { kind: 'drop-column', table: 'orders', column: 'label' }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders DROP COLUMN label;')
  })

  it('rename column', () => {
    const op: AlterOperation = { kind: 'rename-column', table: 'orders', from: 'label', to: 'note' }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders RENAME COLUMN label TO note;')
  })

  it('rename table', () => {
    const op: AlterOperation = { kind: 'rename-table', table: 'orders', to: 'purchases' }
    expect(buildAlterTableSql(op)).toBe('ALTER TABLE orders RENAME TO purchases;')
  })
})
