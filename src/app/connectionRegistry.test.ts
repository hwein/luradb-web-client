import { describe, expect, it } from 'vitest'
import { getTransport } from '../api/transport'
import {
  authFormFields,
  authStatusLabel,
  authWithoutSecret,
  buildAuthHeader,
  buildTransport,
  connectionFormFields,
  connectionHostLabel,
} from './connectionRegistry'

describe('connection-type registry (rest)', () => {
  it('shows the URL field in browser mode too, but disabled with an honest hint (one gate for both modes)', () => {
    const fields = connectionFormFields('rest', 'browser')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ name: 'url', label: 'Server URL', disabled: true })
    expect(fields[0]?.hint).toContain('proxy')
  })

  it('exposes the URL field in desktop mode as a required input without any prefill', () => {
    expect(connectionFormFields('rest', 'desktop')).toEqual([{ name: 'url', label: 'Server URL', kind: 'text', required: true }])
  })

  it('builds a same-origin transport in browser mode, ignoring the stored url', () => {
    const transport = buildTransport({ kind: 'rest', url: 'http://example.invalid' }, 'browser')
    expect(transport.baseUrl).toBe(window.location.origin)
    expect(transport.fetchImpl).toBe(fetch)
  })

  it('builds a transport from the connection url + environment fetch in desktop mode', () => {
    const transport = buildTransport({ kind: 'rest', url: 'http://127.0.0.1:3000' }, 'desktop')
    expect(transport.baseUrl).toBe('http://127.0.0.1:3000')
    expect(transport.fetchImpl).toBe(getTransport().fetchImpl)
  })

  it('reports the window host in browser mode', () => {
    expect(connectionHostLabel({ kind: 'rest', url: 'http://example.invalid' }, 'browser')).toBe(window.location.host)
  })

  it('reports the connection host in desktop mode', () => {
    expect(connectionHostLabel({ kind: 'rest', url: 'http://127.0.0.1:3000' }, 'desktop')).toBe('127.0.0.1:3000')
  })
})

describe('auth-method registry (api-key)', () => {
  it('describes key + remember form fields', () => {
    expect(authFormFields('api-key')).toEqual([
      { name: 'key', label: 'API Key', kind: 'secret' },
      { name: 'remember', label: 'Remember key', kind: 'checkbox' },
    ])
  })

  it('builds a bearer header from the key', () => {
    expect(buildAuthHeader({ kind: 'api-key', key: 'lura_secret' })).toBe('Bearer lura_secret')
  })

  it('omits the header when no key is set', () => {
    expect(buildAuthHeader({ kind: 'api-key', key: undefined })).toBeUndefined()
  })

  it('formats the status label with the given role', () => {
    expect(authStatusLabel({ kind: 'api-key', key: 'x' }, 'admin')).toBe('bearer ✓ admin')
  })

  it('strips the key without touching other fields', () => {
    expect(authWithoutSecret({ kind: 'api-key', key: 'lura_secret' })).toEqual({ kind: 'api-key', key: undefined })
  })
})
