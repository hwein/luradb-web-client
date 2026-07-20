import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/msw'
import { createApi } from './client'
import { getRecordedCalls, record, subscribeRecorder } from './recorder'

const BASE_URL = 'http://127.0.0.1:3000'

describe('recorder', () => {
  it('captures a real call made through the api client', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1700000000 }])))
    const { api, onCall } = createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => undefined })
    const unsubscribe = onCall(record)

    const before = getRecordedCalls().length
    await api.GET('/store-api/domains')
    unsubscribe()

    const after = getRecordedCalls()
    expect(after.length).toBe(before + 1)
    const entry = after.at(-1)
    expect(entry).toMatchObject({ method: 'GET', path: '/store-api/domains', status: 200, ok: true })
    expect(entry?.ms).toBeGreaterThanOrEqual(0)
    expect(typeof entry?.id).toBe('string')
    expect(typeof entry?.ts).toBe('number')
  })

  it('never records bodies, headers or the api key — only method/path/status/ms/ok plus id/ts', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1700000000 }])))
    const { api, onCall } = createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer lura_super_secret' })
    const unsubscribe = onCall(record)

    await api.GET('/store-api/domains')
    unsubscribe()

    const entry = getRecordedCalls().at(-1)
    expect(entry).toMatchObject({ method: 'GET', path: '/store-api/domains', status: 200, ok: true })
    expect(entry).not.toHaveProperty('headers')
    expect(entry).not.toHaveProperty('body')
    expect(entry).not.toHaveProperty('key')
    expect(JSON.stringify(entry)).not.toContain('lura_super_secret')
  })

  it('notifies subscribers on every recorded call', () => {
    let notified = 0
    const unsubscribe = subscribeRecorder(() => {
      notified += 1
    })
    record({ method: 'GET', path: '/store-api/health', status: 200, ms: 1, ok: true })
    unsubscribe()

    expect(notified).toBe(1)
  })

  it('stops notifying once unsubscribed', () => {
    let notified = 0
    const unsubscribe = subscribeRecorder(() => {
      notified += 1
    })
    unsubscribe()
    record({ method: 'GET', path: '/store-api/health', status: 200, ms: 1, ok: true })

    expect(notified).toBe(0)
  })

  it('caps the ring buffer at the last 200 entries', () => {
    for (let i = 0; i < 205; i += 1) {
      record({ method: 'GET', path: `/cap/${i}`, status: 200, ms: 0, ok: true })
    }

    const entries = getRecordedCalls()
    expect(entries.length).toBe(200)
    expect(entries[0]?.path).toBe('/cap/5')
    expect(entries[199]?.path).toBe('/cap/204')
  })
})
