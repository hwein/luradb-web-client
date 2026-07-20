import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { CallLine, StatusCode } from '../lib'
import { server } from '../test/msw'
import { createApi } from './client'
import { withCall } from './withCall'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApi() {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

describe('withCall', () => {
  it('resolves the typed data alongside method/path/status/ms call metadata', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1700000000 }])))
    const { api } = makeApi()

    const { data, call } = await withCall('GET', () => api.GET('/store-api/domains'))

    expect(data).toEqual([{ name: 'shop', created_at: 1700000000 }])
    expect(call.method).toBe('GET')
    expect(call.path).toBe('/store-api/domains')
    expect(call.status).toBe(200)
    expect(call.ms).toBeGreaterThanOrEqual(0)
    expect(call.bodyNote).toBeUndefined()
  })

  it('passes bodyNote through unchanged for the caller to render', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json([])))
    const { api } = makeApi()

    const { call } = await withCall('GET', () => api.GET('/store-api/domains'), 'body {"filter":{}}')

    expect(call.bodyNote).toBe('body {"filter":{}}')
  })

  it('reports the real status and path of a failed call, so screens can render their own error CallLine', async () => {
    server.use(http.get(`${BASE_URL}/store-api/domains`, () => HttpResponse.json({ error: 'nope' }, { status: 409 })))
    const { api } = makeApi()

    const { data, call } = await withCall('GET', () => api.GET('/store-api/domains'))

    expect(data).toBeUndefined()
    expect(call.status).toBe(409)
  })

  it('feeds a screen-style call header (StatusCode + CallLine) with real MSW-sourced values', async () => {
    server.use(
      http.post(`${BASE_URL}/store-api/json/shop/search`, () =>
        HttpResponse.json({ documents: [{ _key: 'cus_8102' }], limit: 50, offset: 0 }),
      ),
    )
    const { api } = makeApi()

    const { call } = await withCall(
      'POST',
      () => api.POST('/store-api/json/{domain}/search', { params: { path: { domain: 'shop' } }, body: {} }),
      'body {"filter":{"city":"Essen"}}',
    )

    render(
      <div>
        <StatusCode status={call.status} ms={call.ms} />
        <CallLine method={call.method} path={call.path} note={call.bodyNote} />
      </div>,
    )

    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('POST /store-api/json/shop/search · body {"filter":{"city":"Essen"}}')).toBeInTheDocument()
  })
})
