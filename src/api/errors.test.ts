import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorFromResponse, networkApiError } from './errors'

describe('apiErrorFromResponse', () => {
  it('uses the "error" field from the response body', async () => {
    const response = new Response(JSON.stringify({ error: 'domain not found' }), {
      status: 404,
      statusText: 'Not Found',
    })
    const err = await apiErrorFromResponse(response)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('domain not found')
    expect(err.body).toEqual({ error: 'domain not found' })
  })

  it('falls back to the "message" field', async () => {
    const response = new Response(JSON.stringify({ message: 'bad request' }), { status: 400 })
    const err = await apiErrorFromResponse(response)
    expect(err.message).toBe('bad request')
  })

  it('falls back to statusText when the body has no error/message field', async () => {
    const response = new Response('', { status: 500, statusText: 'Internal Server Error' })
    const err = await apiErrorFromResponse(response)
    expect(err.message).toBe('Internal Server Error')
  })
})

describe('networkApiError', () => {
  it('reports status 0 with a server-unreachable message', () => {
    const err = networkApiError()
    expect(err.status).toBe(0)
    expect(err.message).toBe('server unreachable')
  })
})
