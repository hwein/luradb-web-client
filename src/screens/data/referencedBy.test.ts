import { describe, expect, it } from 'vitest'
import { buildReferenceProbeRequest, parseRowCount, primaryKeyColumn } from './referencedBy'
import type { components } from '../../api/schema'

type ColumnInfo = components['schemas']['ColumnInfo']

function column(name: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return { name, type: 'TEXT', nullable: true, primary_key: false, autoincrement: false, unique: false, ...overrides }
}

describe('primaryKeyColumn', () => {
  it('picks the column flagged primary_key', () => {
    expect(primaryKeyColumn([column('customer_ref'), column('id', { primary_key: true })])).toBe('id')
  })

  it('falls back to the first column when none is marked primary', () => {
    expect(primaryKeyColumn([column('a'), column('b')])).toBe('a')
  })

  it('is undefined for an empty column list', () => {
    expect(primaryKeyColumn([])).toBeUndefined()
  })
})

describe('buildReferenceProbeRequest', () => {
  it('builds a COUNT(*) select with the document key as the sole positional param', () => {
    expect(buildReferenceProbeRequest('orders', 'customer_ref', 'cus_8102')).toEqual({
      sql: 'SELECT COUNT(*) FROM orders WHERE customer_ref = ?',
      params: ['cus_8102'],
    })
  })
})

describe('parseRowCount', () => {
  it('reads the COUNT(*) value from rows[0][0] (row_count would just be 1 here)', () => {
    expect(parseRowCount({ columns: [{ name: 'COUNT(*)', type: 'INTEGER' }], rows: [[6]], row_count: 1, limit_applied: false })).toBe(6)
  })

  it('defaults to 0 for missing/malformed data', () => {
    expect(parseRowCount(undefined)).toBe(0)
    expect(parseRowCount(null)).toBe(0)
    expect(parseRowCount({})).toBe(0)
    expect(parseRowCount({ rows: [] })).toBe(0)
    expect(parseRowCount({ rows: ['not-a-row'] })).toBe(0)
    expect(parseRowCount({ rows: [['six']] })).toBe(0)
  })
})
