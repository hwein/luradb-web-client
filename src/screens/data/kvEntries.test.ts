import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createApi } from '../../api'
import { kvKeyScan, server } from '../../test/msw'
import {
  EMPTY_KV_KEY_FILTER,
  fetchKvKeysPage,
  formatShortDuration,
  kvBulkKeysQueryOptions,
  kvKeysQueryOptions,
  kvMetaQueryOptions,
  kvValueQueryOptions,
  parseTtlSeconds,
  tryParseJson,
} from './kvEntries'

const BASE_URL = 'http://127.0.0.1:3000'
const KEYS_URL = `${BASE_URL}/store-api/kv/shop/keys`

function makeApi() {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

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

describe('fetchKvKeysPage', () => {
  it('sends prefix/contains only when set, always limit+offset, and mirrors the query on the call path', async () => {
    const urls: URL[] = []
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        urls.push(new URL(request.url))
        return HttpResponse.json(kvKeyScan(['a'], { total: 5, offset: 100, limit: 100 }))
      }),
    )

    const filtered = await fetchKvKeysPage(makeApi(), 'shop', { prefix: 'cart:', contains: 'abc', limit: 100, offset: 100 })
    expect(urls[0]?.searchParams.get('prefix')).toBe('cart:')
    expect(urls[0]?.searchParams.get('contains')).toBe('abc')
    expect(urls[0]?.searchParams.get('limit')).toBe('100')
    expect(urls[0]?.searchParams.get('offset')).toBe('100')
    expect(filtered.call.path).toBe('/store-api/kv/shop/keys?prefix=cart%3A&contains=abc&limit=100&offset=100')

    await fetchKvKeysPage(makeApi(), 'shop', { prefix: '', contains: '', limit: 100, offset: 0 })
    expect(urls[1]?.searchParams.has('prefix')).toBe(false)
    expect(urls[1]?.searchParams.has('contains')).toBe(false)
  })

  it('takes total/offset/limit from the envelope, never from the request (silent server cap stays visible)', async () => {
    server.use(http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['a'], { total: 12000, offset: 0, limit: 10000 }))))

    const page = await fetchKvKeysPage(makeApi(), 'shop', { prefix: '', contains: '', limit: 99999, offset: 0 })

    expect(page).toMatchObject({ keys: ['a'], total: 12000, offset: 0, limit: 10000 })
  })
})

describe('kvKeysQueryOptions', () => {
  it('keys the query by domain, prefix and contains', () => {
    expect(kvKeysQueryOptions(undefined, 'shop', EMPTY_KV_KEY_FILTER).queryKey).toEqual(['kv-keys', 'shop', '', ''])
    expect(kvKeysQueryOptions(undefined, 'shop', { prefix: 'cart:', contains: 'abc' }).queryKey).toEqual(['kv-keys', 'shop', 'cart:', 'abc'])
  })

  it('pages with limit 100 from offset 0 and continues at offset + keys.length while more remain', async () => {
    const urls: URL[] = []
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        const url = new URL(request.url)
        urls.push(url)
        const offset = Number(url.searchParams.get('offset'))
        return HttpResponse.json(kvKeyScan(offset === 0 ? ['a', 'b'] : ['c'], { total: 3, offset, limit: 100 }))
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = kvKeysQueryOptions(makeApi(), 'shop', EMPTY_KV_KEY_FILTER)

    const first = await queryClient.fetchInfiniteQuery(options)
    expect(urls[0]?.searchParams.get('limit')).toBe('100')
    expect(urls[0]?.searchParams.get('offset')).toBe('0')
    expect(options.getNextPageParam(first.pages[0]!, first.pages, 0, [0])).toBe(2)

    // `pages: 2` holt die erste Seite erneut und hängt die zweite ab `offset + keys.length` an.
    const second = await queryClient.fetchInfiniteQuery({ ...options, pages: 2 })
    expect(urls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '0', '2'])
    expect(second.pages.flatMap((page) => page.keys)).toEqual(['a', 'b', 'c'])
    expect(options.getNextPageParam(second.pages[1]!, second.pages, 2, [0, 2])).toBeUndefined()
  })

  it('follows the envelope offset/limit rather than the requested values for the next page', () => {
    const options = kvKeysQueryOptions(undefined, 'shop', EMPTY_KV_KEY_FILTER)
    const page = { keys: ['a', 'b', 'c'], total: 10, offset: 5, limit: 3, call: { method: 'GET', path: '', status: 200, ms: 0 } }
    expect(options.getNextPageParam(page, [page], 0, [0])).toBe(8)
  })

  it('stops on an empty page even while offset < total (no endless loop on concurrent deletes)', () => {
    const options = kvKeysQueryOptions(undefined, 'shop', EMPTY_KV_KEY_FILTER)
    const page = { keys: [], total: 10, offset: 5, limit: 100, call: { method: 'GET', path: '', status: 200, ms: 0 } }
    expect(options.getNextPageParam(page, [page], 5, [0, 5])).toBeUndefined()
  })
})

describe('kvBulkKeysQueryOptions', () => {
  it('keys the query separately from the master list and fetches one page at the server maximum', async () => {
    let url: URL | undefined
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        url = new URL(request.url)
        return HttpResponse.json(kvKeyScan(['a'], { total: 12000, limit: 10000 }))
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = kvBulkKeysQueryOptions(makeApi(), 'shop', { prefix: 'p', contains: 'c' })
    expect(options.queryKey).toEqual(['kv-keys-bulk', 'shop', 'p', 'c'])

    const page = await queryClient.fetchQuery(options)

    expect(url?.searchParams.get('limit')).toBe('10000')
    expect(url?.searchParams.get('offset')).toBe('0')
    expect(url?.searchParams.get('prefix')).toBe('p')
    expect(url?.searchParams.get('contains')).toBe('c')
    expect(page.total).toBe(12000)
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

  it('maps a 204 response to the explicit null state (contract 0.2.0: set_null is an upsert, not a tombstone)', async () => {
    server.use(http.get(`${BASE_URL}/store-api/kv/shop/keys/nulled`, () => new HttpResponse(null, { status: 204 })))
    const apiClient = createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const value = await queryClient.fetchQuery(kvValueQueryOptions(apiClient, 'shop', 'nulled'))

    expect(value).toEqual({ state: 'null' })
  })
})

describe('kvMetaQueryOptions (spec data/012 §1)', () => {
  it('keys by domain and key and is disabled without a connection or key', () => {
    expect(kvMetaQueryOptions(undefined, 'shop', 'cart:1').queryKey).toEqual(['kv-meta', 'shop', 'cart:1'])
    expect(kvMetaQueryOptions(undefined, 'shop', 'cart:1').enabled).toBe(false)
    expect(kvMetaQueryOptions(makeApi(), 'shop', undefined).enabled).toBe(false)
  })

  it('reads expires_at as seconds and last_modified_at as milliseconds; null expiry becomes undefined', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/kv/shop/keys/ttl/meta`, () => HttpResponse.json({ expires_at: 1788011027, last_modified_at: 1788007426476 })),
      http.get(`${BASE_URL}/store-api/kv/shop/keys/plain/meta`, () => HttpResponse.json({ expires_at: null, last_modified_at: 1788007426431 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await expect(queryClient.fetchQuery(kvMetaQueryOptions(makeApi(), 'shop', 'ttl'))).resolves.toEqual({ expiresAtSecs: 1788011027, lastModifiedMs: 1788007426476 })
    await expect(queryClient.fetchQuery(kvMetaQueryOptions(makeApi(), 'shop', 'plain'))).resolves.toEqual({ expiresAtSecs: undefined, lastModifiedMs: 1788007426431 })
  })

  it('treats a 404 (key expired between value and meta read) as null, not as a query error', async () => {
    server.use(http.get(`${BASE_URL}/store-api/kv/shop/keys/gone/meta`, () => HttpResponse.text("404 Not Found: key 'gone' not found", { status: 404 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await expect(queryClient.fetchQuery(kvMetaQueryOptions(makeApi(), 'shop', 'gone'))).resolves.toBeNull()
  })
})

describe('formatShortDuration (spec data/012 §2)', () => {
  it('switches units at the 60 / 3600 / 86400 boundaries', () => {
    expect(formatShortDuration(0)).toBe('0s')
    expect(formatShortDuration(59)).toBe('59s')
    expect(formatShortDuration(60)).toBe('1m')
    expect(formatShortDuration(3599)).toBe('59m')
    expect(formatShortDuration(3600)).toBe('1h 0m')
    expect(formatShortDuration(86399)).toBe('23h 59m')
    expect(formatShortDuration(86400)).toBe('1d 0h')
    expect(formatShortDuration(12 * 86400 + 4 * 3600 + 30)).toBe('12d 4h')
  })

  it('treats negative input (clock skew) as zero', () => {
    expect(formatShortDuration(-0.4)).toBe('0s')
    expect(formatShortDuration(-90)).toBe('0s')
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
