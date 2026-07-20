import { describe, expect, it } from 'vitest'
import type { components } from '../../api/schema'
import {
  blankFormState,
  buildRowPayload,
  expandedOf,
  formStateFromRow,
  formatCellValue,
  isConflict,
  isDangling,
  isLinkColumn,
  parseColumnValue,
  pkValueOf,
  relRowsQueryOptions,
  type RelRowsPage,
} from './relRows'
import { ApiError } from '../../api'

type ColumnInfo = components['schemas']['ColumnInfo']

function column(name: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return { name, type: 'TEXT', nullable: true, primary_key: false, autoincrement: false, unique: false, ...overrides }
}

describe('pkValueOf', () => {
  it('stringifies the pk column value', () => {
    expect(pkValueOf({ id: 42, name: 'x' }, 'id')).toBe('42')
  })

  it('is an empty string for null/undefined', () => {
    expect(pkValueOf({ id: null }, 'id')).toBe('')
    expect(pkValueOf({}, 'id')).toBe('')
  })
})

describe('expandedOf / isDangling', () => {
  it('reads the _expanded block off a row', () => {
    expect(expandedOf({ id: 1, _expanded: { cart_ref: { exists: true, value: 'a' } } })).toEqual({
      cart_ref: { exists: true, value: 'a' },
    })
  })

  it('is undefined without an _expanded block', () => {
    expect(expandedOf({ id: 1 })).toBeUndefined()
  })

  it('treats exists:false as dangling regardless of the REF type wrapper shape (live-verified shapes)', () => {
    expect(isDangling({ exists: false, value: null })).toBe(true)
    expect(isDangling({ exists: false, document: null })).toBe(true)
    expect(isDangling({ exists: true, value: 'cart-contents' })).toBe(false)
    expect(isDangling(undefined)).toBe(false)
    expect(isDangling(null)).toBe(false)
  })
})

describe('formatCellValue', () => {
  it('renders NULL, JSON-stringifies objects, stringifies everything else', () => {
    expect(formatCellValue(null)).toBe('NULL')
    expect(formatCellValue(undefined)).toBe('NULL')
    expect(formatCellValue(42)).toBe('42')
    expect(formatCellValue('hi')).toBe('hi')
    expect(formatCellValue({ exists: true, value: 'a' })).toBe('{"exists":true,"value":"a"}')
  })
})

describe('parseColumnValue', () => {
  it('parses INTEGER/REAL text as a number', () => {
    expect(parseColumnValue('INTEGER', '42')).toBe(42)
    expect(parseColumnValue('REAL', '3.5')).toBe(3.5)
  })

  it('falls back to the raw text when unparseable, instead of risking NaN -> null', () => {
    expect(parseColumnValue('INTEGER', 'abc')).toBe('abc')
  })

  it('leaves TEXT/KVREF/JSONREF and any other type as text', () => {
    expect(parseColumnValue('TEXT', 'hello')).toBe('hello')
    expect(parseColumnValue('KVREF', 'cart_1')).toBe('cart_1')
    expect(parseColumnValue('JSONREF', 'doc_1')).toBe('doc_1')
  })
})

describe('blankFormState / formStateFromRow', () => {
  const columns = [column('id', { type: 'INTEGER', primary_key: true, nullable: false }), column('label')]

  it('blank state is empty, non-null for every column', () => {
    expect(blankFormState(columns)).toEqual({ id: { text: '', isNull: false }, label: { text: '', isNull: false } })
  })

  it('seeds text from the row, flags isNull for actual nulls (not just empty)', () => {
    expect(formStateFromRow(columns, { id: 42, label: null })).toEqual({
      id: { text: '42', isNull: false },
      label: { text: '', isNull: true },
    })
  })
})

describe('buildRowPayload', () => {
  const columns = [
    column('id', { type: 'INTEGER', primary_key: true, autoincrement: true, nullable: false }),
    column('total', { type: 'REAL', nullable: false }),
    column('label', { type: 'TEXT', nullable: true }),
  ]

  it('insert: omits an autoincrement PK even if typed, parses numeric text, omits blank fields', () => {
    const form = { id: { text: '99', isNull: false }, total: { text: '214.9', isNull: false }, label: { text: '', isNull: false } }
    expect(buildRowPayload(columns, form, 'insert')).toEqual({ total: 214.9 })
  })

  it('insert: a non-autoincrement PK is included', () => {
    const manualPk = [column('code', { type: 'TEXT', primary_key: true, nullable: false }), column('label')]
    const form = { code: { text: 'A1', isNull: false }, label: { text: '', isNull: false } }
    expect(buildRowPayload(manualPk, form, 'insert')).toEqual({ code: 'A1' })
  })

  it('update: never includes the PK, sends null for a checked nullable field', () => {
    const form = { id: { text: '99', isNull: false }, total: { text: '10', isNull: false }, label: { text: 'x', isNull: true } }
    expect(buildRowPayload(columns, form, 'update')).toEqual({ total: 10, label: null })
  })

  it('a blank NOT NULL field is simply omitted (left for the server to reject)', () => {
    const form = { id: { text: '', isNull: false }, total: { text: '', isNull: false }, label: { text: '', isNull: false } }
    expect(buildRowPayload(columns, form, 'update')).toEqual({})
  })
})

describe('isLinkColumn', () => {
  it('is true for KVREF and JSONREF columns', () => {
    expect(isLinkColumn(column('cart_ref', { type: 'KVREF' }))).toBe(true)
    expect(isLinkColumn(column('doc_ref', { type: 'JSONREF' }))).toBe(true)
  })

  it('is true for a REFERENCES-constrained column (rel→rel FK), detected via `references`', () => {
    expect(isLinkColumn(column('customer_id', { type: 'INTEGER', references: 'customers' }))).toBe(true)
  })

  it('is false for a plain column of any other type', () => {
    expect(isLinkColumn(column('label', { type: 'TEXT' }))).toBe(false)
    expect(isLinkColumn(column('total', { type: 'REAL' }))).toBe(false)
    expect(isLinkColumn(column('id', { type: 'INTEGER', primary_key: true }))).toBe(false)
  })
})

describe('isConflict', () => {
  it('is true only for 409 ApiErrors', () => {
    expect(isConflict(new ApiError(409, 'cross-engine link target missing'))).toBe(true)
    expect(isConflict(new ApiError(400, 'must not be NULL'))).toBe(false)
    expect(isConflict(new Error('boom'))).toBe(false)
  })
})

function page(overrides: Partial<RelRowsPage> = {}): RelRowsPage {
  return { rows: [], offset: 0, limitApplied: false, call: { method: 'GET', path: '/store-api/rel/shop/tables/orders/rows', status: 200, ms: 1 }, ...overrides }
}

describe('relRowsQueryOptions', () => {
  it('keys the query by domain, table and the expand flag', () => {
    const off = relRowsQueryOptions(undefined, 'shop', 'orders', false, true)
    const on = relRowsQueryOptions(undefined, 'shop', 'orders', true, true)
    expect(off.queryKey).toEqual(['rel-rows', 'shop', 'orders', false])
    expect(on.queryKey).toEqual(['rel-rows', 'shop', 'orders', true])
  })

  it('requests the next offset while limit_applied signals more rows, stops once the server stops truncating', () => {
    const options = relRowsQueryOptions(undefined, 'shop', 'orders', false, true)
    const truncated = page({ rows: [{ id: 1 }, { id: 2 }], offset: 0, limitApplied: true })
    expect(options.getNextPageParam?.(truncated, [truncated], 0, [0])).toBe(2)

    const exhausted = page({ rows: [{ id: 3 }], offset: 2, limitApplied: false })
    expect(options.getNextPageParam?.(exhausted, [exhausted], 2, [0, 2])).toBeUndefined()
  })
})
