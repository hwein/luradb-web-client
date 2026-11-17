import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createApi } from '../../api/client'
import { server } from '../../test/msw'
import { kvBulkCallPattern, kvBulkConfirmText, kvBulkDeletePath, kvBulkServerDeleteConfirmText, runKvBulk, runKvBulkDelete, runKvBulkOp, usesServerDelete } from './kvBulk'

const BASE_URL = 'http://127.0.0.1:3000'
const DOMAIN = 'sessions'

function makeApi() {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

describe('kvBulkCallPattern', () => {
  it('describes each action as method + templated path with a literal {key} placeholder', () => {
    expect(kvBulkCallPattern('delete', DOMAIN)).toBe(`DELETE /store-api/kv/${DOMAIN}/keys/{key}`)
    expect(kvBulkCallPattern('clear', DOMAIN)).toBe(`PUT /store-api/kv/${DOMAIN}/keys/{key}`)
    expect(kvBulkCallPattern('set-null', DOMAIN)).toBe(`PATCH /store-api/kv/${DOMAIN}/keys/{key}/null`)
  })
})

describe('kvBulkConfirmText', () => {
  it('matches the spec example for delete', () => {
    expect(kvBulkConfirmText('delete', 138, 'sessions')).toBe('delete 138 keys in "sessions"?')
  })

  it('phrases clear and set-null as a verb + "on"', () => {
    expect(kvBulkConfirmText('clear', 3, 'shop')).toBe('set value to "" on 3 keys in "shop"?')
    expect(kvBulkConfirmText('set-null', 3, 'shop')).toBe('set null on 3 keys in "shop"?')
  })
})

describe('usesServerDelete', () => {
  it('routes only delete with a non-empty prefix to the server endpoint (spec data/013 §1)', () => {
    expect(usesServerDelete('delete', { prefix: 'user-', contains: '' })).toBe(true)
    expect(usesServerDelete('delete', { prefix: '', contains: 'x' })).toBe(false)
    expect(usesServerDelete('clear', { prefix: 'user-', contains: '' })).toBe(false)
    expect(usesServerDelete('set-null', { prefix: 'user-', contains: '' })).toBe(false)
  })
})

describe('kvBulkDeletePath', () => {
  it('always carries prefix, adds contains only when set, and encodes both', () => {
    expect(kvBulkDeletePath('sessions', { prefix: 'user-', contains: '' })).toBe('/store-api/kv/sessions/keys?prefix=user-')
    expect(kvBulkDeletePath('sessions', { prefix: 'user:', contains: 'a b' })).toBe('/store-api/kv/sessions/keys?prefix=user%3A&contains=a+b')
  })
})

describe('kvBulkServerDeleteConfirmText', () => {
  it('names the criterion instead of a count, with and without contains', () => {
    expect(kvBulkServerDeleteConfirmText('sessions', { prefix: 'user-', contains: '' })).toBe('delete all keys with prefix "user-" in "sessions"?')
    expect(kvBulkServerDeleteConfirmText('sessions', { prefix: 'user-', contains: '2026' })).toBe('delete all keys with prefix "user-" containing "2026" in "sessions"?')
  })
})

describe('runKvBulkDelete', () => {
  it('sends one DELETE …/keys?prefix= and returns the deleted count', async () => {
    let received: URL | undefined
    server.use(
      http.delete(`${BASE_URL}/store-api/kv/${DOMAIN}/keys`, ({ request }) => {
        received = new URL(request.url)
        return HttpResponse.json({ deleted: 3 })
      }),
    )
    await expect(runKvBulkDelete(makeApi(), DOMAIN, { prefix: 'user-', contains: '' })).resolves.toBe(3)
    expect(received?.searchParams.get('prefix')).toBe('user-')
    expect(received?.searchParams.has('contains')).toBe(false)
  })

  it('rejects with the literal 413 server text (nothing deleted, no client rewording)', async () => {
    server.use(
      http.delete(`${BASE_URL}/store-api/kv/${DOMAIN}/keys`, () =>
        HttpResponse.text('413 Payload Too Large: 10500 keys match the selection, limit is 10000', { status: 413 }),
      ),
    )
    await expect(runKvBulkDelete(makeApi(), DOMAIN, { prefix: 'big-', contains: '' })).rejects.toThrow('413 Payload Too Large: 10500 keys match the selection, limit is 10000')
  })

  it('rejects when the response has no numeric deleted field', async () => {
    server.use(http.delete(`${BASE_URL}/store-api/kv/${DOMAIN}/keys`, () => HttpResponse.json({})))
    await expect(runKvBulkDelete(makeApi(), DOMAIN, { prefix: 'user-', contains: '' })).rejects.toThrow('unexpected bulk delete response')
  })
})

describe('runKvBulkOp', () => {
  it('sends DELETE for the delete action and resolves on 204', async () => {
    let receivedMethod: string | undefined
    server.use(
      http.delete(`${BASE_URL}/store-api/kv/${DOMAIN}/keys/k1`, ({ request }) => {
        receivedMethod = request.method
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await expect(runKvBulkOp(makeApi(), DOMAIN, 'delete', 'k1')).resolves.toBeUndefined()
    expect(receivedMethod).toBe('DELETE')
  })

  it('sends PUT with an empty text/plain body for the clear ("set value to \\"\\"") action', async () => {
    let body: string | undefined
    let contentType: string | null = null
    server.use(
      http.put(`${BASE_URL}/store-api/kv/${DOMAIN}/keys/k1`, async ({ request }) => {
        body = await request.text()
        contentType = request.headers.get('Content-Type')
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await runKvBulkOp(makeApi(), DOMAIN, 'clear', 'k1')
    expect(body).toBe('')
    expect(contentType).toBe('text/plain')
  })

  it('sends PATCH …/null for the set-null action', async () => {
    let path: string | undefined
    server.use(
      http.patch(`${BASE_URL}/store-api/kv/${DOMAIN}/keys/k1/null`, ({ request }) => {
        path = new URL(request.url).pathname
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await runKvBulkOp(makeApi(), DOMAIN, 'set-null', 'k1')
    expect(path).toBe(`/store-api/kv/${DOMAIN}/keys/k1/null`)
  })

  it('throws with the original text on a 429 (text/plain rate-limit body)', async () => {
    server.use(
      http.delete(`${BASE_URL}/store-api/kv/${DOMAIN}/keys/k1`, () => new HttpResponse('rate limit exceeded, retry in 2s', { status: 429 })),
    )
    await expect(runKvBulkOp(makeApi(), DOMAIN, 'delete', 'k1')).rejects.toThrow('rate limit exceeded, retry in 2s')
  })

  it('throws with the `error` field on a JSON error body', async () => {
    server.use(http.delete(`${BASE_URL}/store-api/kv/${DOMAIN}/keys/k1`, () => HttpResponse.json({ error: 'domain not found' }, { status: 404 })))
    await expect(runKvBulkOp(makeApi(), DOMAIN, 'delete', 'k1')).rejects.toThrow('domain not found')
  })
})

/** Pollt Mikrotasks, bis `predicate` zutrifft — Fake-Timer-frei (spec §7), robust gegen Engine-Details der await-Tick-Zahl. */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i += 1) {
    await Promise.resolve()
  }
}

describe('runKvBulk', () => {
  it('applies allSettled semantics: a failing op does not stop the others, and onProgress reaches total', async () => {
    const keys = ['a', 'b', 'c', 'd']
    const progressCalls: Array<[number, number]> = []
    const result = await runKvBulk(
      keys,
      2,
      async (key) => {
        if (key === 'b') throw new Error('boom')
      },
      (done, total) => progressCalls.push([done, total]),
    )

    expect(result.okCount).toBe(3)
    expect(result.failures).toEqual([{ key: 'b', message: 'boom' }])
    expect(progressCalls).toHaveLength(4)
    expect(progressCalls.at(-1)).toEqual([4, 4])
  })

  it('never runs more than `concurrency` executions at once, and completes all ops (Promise-controlled, no fake timers)', async () => {
    const keys = Array.from({ length: 6 }, (_, i) => `k${i}`)
    let inFlight = 0
    let maxInFlight = 0
    const pending: Array<() => void> = []

    const executeOp = vi.fn(() => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise<void>((resolve) => {
        pending.push(() => {
          inFlight -= 1
          resolve()
        })
      })
    })

    const runPromise = runKvBulk(keys, 2, executeOp, () => {})

    // Der Worker-Pool startet seine ersten `concurrency` Ops synchron beim Aufruf — kein Flush nötig.
    expect(executeOp).toHaveBeenCalledTimes(2)
    expect(inFlight).toBe(2)

    for (let i = 0; i < keys.length; i += 1) {
      await flushUntil(() => pending.length > 0)
      pending.shift()?.()
    }

    const result = await runPromise
    expect(result.okCount).toBe(6)
    expect(executeOp).toHaveBeenCalledTimes(6)
    expect(maxInFlight).toBe(2)
  })
})
