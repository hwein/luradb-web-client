import { describe, expect, it } from 'vitest'
import { identifierError } from './identifier'

describe('identifierError', () => {
  it('accepts a plain lowercase identifier', () => {
    expect(identifierError('orders')).toBeUndefined()
  })

  it('accepts an underscore-led identifier', () => {
    expect(identifierError('_private')).toBeUndefined()
  })

  it('accepts exactly 50 characters', () => {
    expect(identifierError('a'.repeat(50))).toBeUndefined()
  })

  it('rejects the empty string', () => {
    expect(identifierError('')).toBe('name is required')
  })

  it('rejects a leading digit', () => {
    expect(identifierError('1abc')).toBeDefined()
  })

  it('rejects uppercase letters', () => {
    expect(identifierError('Orders')).toBeDefined()
  })

  it('rejects a hyphen', () => {
    expect(identifierError('my-table')).toBeDefined()
  })

  it('rejects 51 characters', () => {
    expect(identifierError('a'.repeat(51))).toBeDefined()
  })

  // Vollständige Blockliste api/LURASQL.md: Grammatik-Keywords + alle Typnamen/Aliase.
  it.each([
    'create',
    'table',
    'alter',
    'drop',
    'add',
    'column',
    'rename',
    'to',
    'index',
    'unique',
    'on',
    'view',
    'as',
    'insert',
    'into',
    'values',
    'update',
    'set',
    'delete',
    'from',
    'select',
    'left',
    'outer',
    'join',
    'where',
    'order',
    'by',
    'asc',
    'desc',
    'limit',
    'offset',
    'and',
    'or',
    'not',
    'in',
    'like',
    'is',
    'null',
    'primary',
    'key',
    'autoincrement',
    'default',
    'references',
    'count',
    'current_timestamp',
    'true',
    'false',
    'integer',
    'int',
    'bigint',
    'smallint',
    'real',
    'float',
    'double',
    'text',
    'varchar',
    'char',
    'boolean',
    'bool',
    'timestamp',
    'datetime',
    'kvref',
    'jsonref',
  ])('rejects the reserved word "%s"', (word) => {
    expect(identifierError(word)).toBe(`"${word}" is a reserved word`)
  })

  it('rejects a name that is a reserved word even though it looks like a valid identifier otherwise', () => {
    expect(identifierError('select')).toBeDefined()
  })
})
