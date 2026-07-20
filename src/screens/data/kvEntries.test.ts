import { describe, expect, it } from 'vitest'
import { kvKeysQueryOptions, kvValueQueryOptions, parseTtlSeconds, tryParseJson } from './kvEntries'

describe('tryParseJson', () => {
  it('returns the parsed value for valid JSON', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 })
    expect(tryParseJson('null')).toBeNull()
    expect(tryParseJson('42')).toBe(42)
  })

  it('returns undefined for plaintext that is not valid JSON', () => {
    expect(tryParseJson('hello world')).toBeUndefined()
    expect(tryParseJson('')).toBeUndefined()
  })
})

describe('kvKeysQueryOptions', () => {
  it('keys the query by domain and prefix', () => {
    const noPrefix = kvKeysQueryOptions(undefined, 'shop', '')
    const withPrefix = kvKeysQueryOptions(undefined, 'shop', 'cart:')
    expect(noPrefix.queryKey).toEqual(['kv-keys', 'shop', ''])
    expect(withPrefix.queryKey).toEqual(['kv-keys', 'shop', 'cart:'])
  })
})

describe('kvValueQueryOptions', () => {
  it('keys the query by domain and key', () => {
    const options = kvValueQueryOptions(undefined, 'shop', 'cart:1')
    expect(options.queryKey).toEqual(['kv-value', 'shop', 'cart:1'])
  })

  it('is disabled without an active connection or a selected key', () => {
    expect(kvValueQueryOptions(undefined, 'shop', 'cart:1').enabled).toBe(false)
    expect(kvValueQueryOptions(undefined, 'shop', undefined).enabled).toBe(false)
  })
})

describe('parseTtlSeconds', () => {
  it('treats empty (trimmed) input as no param — unbefristet', () => {
    expect(parseTtlSeconds('')).toEqual({ ok: true, seconds: undefined })
    expect(parseTtlSeconds('   ')).toEqual({ ok: true, seconds: undefined })
  })

  it('accepts a positive integer', () => {
    expect(parseTtlSeconds('1')).toEqual({ ok: true, seconds: 1 })
    expect(parseTtlSeconds(' 120 ')).toEqual({ ok: true, seconds: 120 })
  })

  it('rejects zero, negative, and non-integer input', () => {
    expect(parseTtlSeconds('0')).toEqual({ ok: false, error: 'ttl must be a positive integer (seconds)' })
    expect(parseTtlSeconds('-1')).toEqual({ ok: false, error: 'ttl must be a positive integer (seconds)' })
    expect(parseTtlSeconds('1.5')).toEqual({ ok: false, error: 'ttl must be a positive integer (seconds)' })
    expect(parseTtlSeconds('abc')).toEqual({ ok: false, error: 'ttl must be a positive integer (seconds)' })
  })
})
