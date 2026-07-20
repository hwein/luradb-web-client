import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { createApi, type CallInfo } from './client'
import { ApiError } from './errors'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApi(getAuthHeader: () => string | undefined = () => 'Bearer test-key') {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader })
}

describe('createApi', () => {
  it('sets the Authorization header on typed calls', async () => {
    let receivedAuth: string | null = null
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization')
        return HttpResponse.json([{ name: 'shop', created_at: 1700000000 }])
      }),
    )

    const { api } = makeApi()
    const { data, error } = await api.GET('/store-api/domains')

    expect(receivedAuth).toBe('Bearer test-key')
    expect(error).toBeUndefined()
    expect(data).toEqual([{ name: 'shop', created_at: 1700000000 }])
  })

  it('skips the Authorization header when getAuthHeader returns undefined', async () => {
    let receivedAuth: string | null = 'unset'
    server.use(
      http.get(`${BASE_URL}/store-api/domains`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization')
        return HttpResponse.json([])
      }),
    )

    const { api } = makeApi(() => undefined)
    await api.GET('/store-api/domains')

    expect(receivedAuth).toBeNull()
  })

  it('notifies onCall listeners with method, path, status and duration', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([])))

    const { api, onCall } = makeApi()
    const calls: CallInfo[] = []
    const unsubscribe = onCall((info) => calls.push(info))
    await api.GET('/store-api/domains')
    unsubscribe()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/store-api/domains', status: 200, ok: true })
    expect(calls[0]?.ms).toBeGreaterThanOrEqual(0)
  })

  it('does not leak query strings into the recorded path', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([])))

    const { fetchRaw, onCall } = makeApi()
    const calls: CallInfo[] = []
    onCall((info) => calls.push(info))
    await fetchRaw('/store-api/domains?secret=shh')

    expect(calls[0]?.path).toBe('/store-api/domains')
  })

  it('fetchRaw throws ApiError with the body message on a 4xx response', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/kv/shop/keys/missing`, () =>
        HttpResponse.json({ error: 'key not found' }, { status: 404 }),
      ),
    )

    const { fetchRaw } = makeApi()
    await expect(fetchRaw('/store-api/kv/shop/keys/missing')).rejects.toMatchObject({
      status: 404,
      message: 'key not found',
    })
  })

  it('fetchRaw resolves with the raw Response on success', async () => {
    server.use(http.get(`${BASE_URL}/store-api/kv/shop/keys/present`, () => new Response('raw-bytes')))

    const { fetchRaw } = makeApi()
    const response = await fetchRaw('/store-api/kv/shop/keys/present')
    await expect(response.text()).resolves.toBe('raw-bytes')
  })

  it('fetchNdjson sends an ndjson Accept header', async () => {
    let acceptHeader: string | null = null
    server.use(
      http.get(`${BASE_URL}/store-api/json/shop/export`, ({ request }) => {
        acceptHeader = request.headers.get('Accept')
        return new Response('{"a":1}\n{"a":2}\n')
      }),
    )

    const { fetchNdjson } = makeApi()
    await fetchNdjson('/store-api/json/shop/export')

    expect(acceptHeader).toBe('application/x-ndjson')
  })

  it('reports network failures as a status-0 ApiError and notifies listeners', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.error()))

    const { api, onCall } = makeApi()
    const calls: CallInfo[] = []
    onCall((info) => calls.push(info))

    await expect(api.GET('/store-api/domains')).rejects.toBeInstanceOf(ApiError)
    expect(calls[0]).toMatchObject({ status: 0, ok: false })
  })

  it('openStream sends Accept: text/event-stream with the auth header and records status "stream"', async () => {
    let accept: string | null = null
    let auth: string | null = null
    server.use(
      http.get(`${BASE_URL}/store-api/kv/shop/watch`, ({ request }) => {
        accept = request.headers.get('Accept')
        auth = request.headers.get('Authorization')
        return new HttpResponse('event: set\ndata: k\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      }),
    )

    const { openStream, onCall } = makeApi()
    const calls: CallInfo[] = []
    onCall((info) => calls.push(info))
    const response = await openStream('/store-api/kv/shop/watch?prefix=x')

    expect(accept).toBe('text/event-stream')
    expect(auth).toBe('Bearer test-key')
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/store-api/kv/shop/watch', status: 'stream', ok: true })
    expect(response.body).not.toBeNull()
    await expect(response.text()).resolves.toContain('event: set')
  })

  it('openStream returns a non-2xx response without throwing and records the numeric status', async () => {
    server.use(http.get(`${BASE_URL}/store-api/kv/gone/watch`, () => new HttpResponse(null, { status: 410 })))

    const { openStream, onCall } = makeApi()
    const calls: CallInfo[] = []
    onCall((info) => calls.push(info))
    const response = await openStream('/store-api/kv/gone/watch')

    expect(response.status).toBe(410)
    expect(calls[0]).toMatchObject({ path: '/store-api/kv/gone/watch', status: 410, ok: false })
  })
})
