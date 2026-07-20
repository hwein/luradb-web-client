import { describe, expect, it } from 'vitest'
import { documentPreview, isJsonObject, isConflict, jsonDocumentsQueryOptions, safeJsonParse, type DocumentPage } from './jsonDocuments'
import { ApiError } from '../../api'

describe('documentPreview', () => {
  it('compacts the document and strips _key/_version', () => {
    expect(documentPreview({ _key: 'cus_1', _version: 7, name: 'M. Keller', city: 'Essen' })).toBe(
      '{"name":"M. Keller","city":"Essen"}',
    )
  })

  it('truncates to ~60 chars with an ellipsis', () => {
    const long = documentPreview({ _key: 'x', text: 'a'.repeat(80) })
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBe(61)
  })
})

describe('isJsonObject', () => {
  it('accepts plain objects, rejects arrays/null/primitives', () => {
    expect(isJsonObject({})).toBe(true)
    expect(isJsonObject([])).toBe(false)
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject('x')).toBe(false)
    expect(isJsonObject(42)).toBe(false)
  })
})

describe('safeJsonParse', () => {
  it('returns the parsed value on success', () => {
    const result = safeJsonParse('{"city":"Essen"}')
    expect(result).toEqual({ ok: true, value: { city: 'Essen' } })
  })

  it('returns an inline error on invalid JSON, without throwing', () => {
    const result = safeJsonParse('{city:')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('isConflict', () => {
  it('treats 409 and 412 as a version conflict', () => {
    expect(isConflict(new ApiError(409, 'conflict'))).toBe(true)
    expect(isConflict(new ApiError(412, 'precondition failed'))).toBe(true)
  })

  it('treats other statuses and non-ApiErrors as not conflicting', () => {
    expect(isConflict(new ApiError(404, 'not found'))).toBe(false)
    expect(isConflict(new Error('boom'))).toBe(false)
  })
})

function page(overrides: Partial<DocumentPage>): DocumentPage {
  return {
    documents: [],
    total: 0,
    offset: 0,
    limit: 50,
    call: { method: 'GET', path: '/store-api/json/shop/documents', status: 200, ms: 1 },
    ...overrides,
  }
}

describe('jsonDocumentsQueryOptions', () => {
  it('keys the query by domain and the committed filter text (list vs. search share nothing)', () => {
    const list = jsonDocumentsQueryOptions(undefined, 'shop', undefined)
    const search = jsonDocumentsQueryOptions(undefined, 'shop', { text: '{"city":"Essen"}', value: { city: 'Essen' } })
    expect(list.queryKey).toEqual(['json-documents', 'shop', ''])
    expect(search.queryKey).toEqual(['json-documents', 'shop', '{"city":"Essen"}'])
  })

  it('requests the next offset while more documents remain, stops once everything loaded', () => {
    const options = jsonDocumentsQueryOptions(undefined, 'shop', undefined)
    const partial = page({ documents: [{ key: 'a', version: 1, preview: '{}' }], offset: 0, total: 2 })
    expect(options.getNextPageParam?.(partial, [partial], 0, [0])).toBe(1)

    const complete = page({ documents: [{ key: 'a', version: 1, preview: '{}' }], offset: 1, total: 2 })
    expect(options.getNextPageParam?.(complete, [complete], 1, [0, 1])).toBeUndefined()
  })
})
