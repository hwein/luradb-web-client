import { describe, expect, it } from 'vitest'
import {
  buildCreateViewSql,
  buildNdjson,
  buildSqlRequest,
  docIdForStatus,
  isSelect,
  messageFromError,
  PARAMS_ERROR,
  parseParams,
  parseSqlResult,
  statementLabel,
  type SqlSelectResult,
} from './sqlRun'

describe('buildSqlRequest', () => {
  it('includes expand only for SELECT with a non-empty column list', () => {
    expect(buildSqlRequest('SELECT * FROM t', ['a'], [])).toEqual({ sql: 'SELECT * FROM t', expand: ['a'] })
    expect(buildSqlRequest('  select id from t', ['*'], [])).toEqual({ sql: '  select id from t', expand: ['*'] })
  })

  it('omits expand for non-SELECT statements or an empty list (avoids the 400 trap)', () => {
    expect(buildSqlRequest('INSERT INTO t VALUES (1)', ['a'], [])).toEqual({ sql: 'INSERT INTO t VALUES (1)' })
    expect(buildSqlRequest('SELECT 1', [], [])).toEqual({ sql: 'SELECT 1' })
  })

  it('includes params for SELECT and for DML alike (unlike the SELECT-only expand)', () => {
    expect(buildSqlRequest('SELECT * FROM t WHERE status = ?', [], ['paid'])).toEqual({
      sql: 'SELECT * FROM t WHERE status = ?',
      params: ['paid'],
    })
    expect(buildSqlRequest('UPDATE t SET a = ? WHERE id = ?', [], ['x', 1])).toEqual({
      sql: 'UPDATE t SET a = ? WHERE id = ?',
      params: ['x', 1],
    })
    expect(buildSqlRequest('INSERT INTO t (a) VALUES (?)', [], [42])).toEqual({
      sql: 'INSERT INTO t (a) VALUES (?)',
      params: [42],
    })
  })

  it('omits params for an empty array', () => {
    expect(buildSqlRequest('SELECT 1', [], [])).toEqual({ sql: 'SELECT 1' })
  })
})

describe('parseParams', () => {
  it('treats empty/whitespace text as an empty params array (field omitted from the body)', () => {
    expect(parseParams('')).toEqual({ ok: true, params: [] })
    expect(parseParams('   ')).toEqual({ ok: true, params: [] })
  })

  it('parses a JSON array as-is', () => {
    expect(parseParams('["paid", 42]')).toEqual({ ok: true, params: ['paid', 42] })
  })

  it('rejects JSON that parses but is not an array', () => {
    expect(parseParams('{}')).toEqual({ ok: false, error: PARAMS_ERROR })
    expect(parseParams('42')).toEqual({ ok: false, error: PARAMS_ERROR })
  })

  it('rejects text that is not valid JSON at all', () => {
    expect(parseParams('[1,')).toEqual({ ok: false, error: PARAMS_ERROR })
  })
})

describe('isSelect', () => {
  it('detects SELECT case-insensitively with leading whitespace', () => {
    expect(isSelect('  SeLeCt 1')).toBe(true)
    expect(isSelect('DELETE FROM t')).toBe(false)
  })
})

describe('parseSqlResult', () => {
  it('parses a SELECT result with columns, array rows and expanded', () => {
    const result = parseSqlResult({
      columns: [{ name: 'id', type: 'INTEGER' }],
      rows: [[1], [2]],
      row_count: 2,
      limit_applied: true,
      expanded: { ref: [{ exists: true }, { exists: false }] },
    })
    expect(result).toEqual({
      kind: 'select',
      columns: [{ name: 'id', type: 'INTEGER' }],
      rows: [[1], [2]],
      rowCount: 2,
      limitApplied: true,
      expanded: { ref: [{ exists: true }, { exists: false }] },
    })
  })

  it('parses DML and DDL by field presence', () => {
    expect(parseSqlResult({ affected: 3, last_pk: 7 })).toEqual({ kind: 'dml', affected: 3, lastPk: 7 })
    expect(parseSqlResult({ ok: true })).toEqual({ kind: 'ddl', label: '' })
  })

  it('returns undefined for unrecognized shapes', () => {
    expect(parseSqlResult(null)).toBeUndefined()
    expect(parseSqlResult({ foo: 1 })).toBeUndefined()
  })
})

describe('statementLabel', () => {
  it('labels DDL by its leading keywords', () => {
    expect(statementLabel('create view v as select 1')).toBe('CREATE VIEW')
    expect(statementLabel('DROP TABLE t')).toBe('DROP TABLE')
    expect(statementLabel('SELECT 1')).toBe('SELECT')
  })
})

describe('buildCreateViewSql', () => {
  it('wraps the editor SQL and strips a trailing semicolon', () => {
    expect(buildCreateViewSql('paid', 'SELECT * FROM orders;')).toBe('CREATE VIEW paid AS SELECT * FROM orders')
    expect(buildCreateViewSql('v', '  SELECT 1 ')).toBe('CREATE VIEW v AS SELECT 1')
  })
})

describe('buildNdjson', () => {
  it('emits one object per row with embedded _expanded values', () => {
    const result: SqlSelectResult = {
      kind: 'select',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'ref', type: 'KVREF' },
      ],
      rows: [
        [1, 'k1'],
        [2, 'k2'],
      ],
      rowCount: 2,
      limitApplied: false,
      expanded: { ref: [{ exists: true, value: 'a' }, { exists: false }] },
    }
    const [first, second] = buildNdjson(result).split('\n')
    expect(JSON.parse(first ?? '{}')).toEqual({ id: 1, ref: 'k1', _expanded: { ref: { exists: true, value: 'a' } } })
    expect(JSON.parse(second ?? '{}')).toEqual({ id: 2, ref: 'k2', _expanded: { ref: { exists: false } } })
  })

  it('omits _expanded when the result has none', () => {
    const result: SqlSelectResult = {
      kind: 'select',
      columns: [{ name: 'id', type: 'INT' }],
      rows: [[1]],
      rowCount: 1,
      limitApplied: false,
    }
    expect(JSON.parse(buildNdjson(result))).toEqual({ id: 1 })
  })
})

describe('messageFromError', () => {
  it('uses a plain-text body verbatim', () => {
    expect(messageFromError('syntax error at position 0', 400)).toBe('syntax error at position 0')
  })

  it('reads error/message from an object body, else falls back to the status', () => {
    expect(messageFromError({ error: 'boom' }, 409)).toBe('boom')
    expect(messageFromError(undefined, 500)).toBe('request failed (HTTP 500)')
  })
})

describe('docIdForStatus', () => {
  it('maps 409 to cross-engine-links, 400 to lurasql, others to errors-status-codes', () => {
    expect(docIdForStatus(409)).toBe('cross-engine-links')
    expect(docIdForStatus(400)).toBe('lurasql')
    expect(docIdForStatus(404)).toBe('errors-status-codes')
  })
})
