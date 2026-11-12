import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTransport } from '../api/transport'
import {
  authFormFields,
  authStatusLabel,
  authWithoutSecret,
  buildAuthHeader,
  buildTransport,
  connectionFormFields,
  connectionHostLabel,
  connectionServerUrl,
} from './connectionRegistry'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('connection-type registry (rest)', () => {
  it('offers an editable, optional url field in browser mode whose hint names the proxy and [cors]', () => {
    const fields = connectionFormFields('rest', 'browser')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ name: 'url', label: 'Server URL', kind: 'text' })
    expect(fields[0]?.disabled).toBeUndefined()
    expect(fields[0]?.required).toBeUndefined()
    expect(fields[0]?.hint).toContain('proxy')
    expect(fields[0]?.hint).toContain('[cors]')
  })

  it('exposes the URL field in desktop mode as a required input without any prefill, plus an accept-invalid-certs checkbox', () => {
    const fields = connectionFormFields('rest', 'desktop')
    expect(fields).toHaveLength(2)
    expect(fields[0]).toEqual({ name: 'url', label: 'Server URL', kind: 'text', required: true })
    expect(fields[1]).toMatchObject({ name: 'acceptInvalidCerts', label: 'Accept self-signed certificates', kind: 'checkbox' })
    expect(fields[1]?.hint).toContain('TLS')
  })

  it('resolves the effective server url per environment', () => {
    expect(connectionServerUrl({ kind: 'rest', url: 'http://luradb.test:3000' }, 'desktop')).toBe('http://luradb.test:3000')
    expect(connectionServerUrl({ kind: 'rest', url: '' }, 'browser')).toBe(window.location.origin)
    expect(connectionServerUrl({ kind: 'rest', url: 'http://luradb.test:3000' }, 'browser')).toBe('http://luradb.test:3000')
  })

  it('builds a same-origin transport in browser mode for an empty url', () => {
    const transport = buildTransport({ kind: 'rest', url: '' }, 'browser')
    expect(transport.baseUrl).toBe(window.location.origin)
    expect(transport.fetchImpl).toBe(fetch)
  })

  it('builds a direct transport to the stored url in browser mode', () => {
    const transport = buildTransport({ kind: 'rest', url: 'http://luradb.test:3000' }, 'browser')
    expect(transport.baseUrl).toBe('http://luradb.test:3000')
    expect(transport.fetchImpl).toBe(fetch)
  })

  it('builds a transport from the connection url + environment fetch in desktop mode', () => {
    const transport = buildTransport({ kind: 'rest', url: 'http://127.0.0.1:3000' }, 'desktop')
    expect(transport.baseUrl).toBe('http://127.0.0.1:3000')
    expect(transport.fetchImpl).toBe(getTransport().fetchImpl)
  })

  it('threads acceptInvalidCerts into a danger init on every plugin-http call when the flag is set', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const transport = buildTransport({ kind: 'rest', url: 'https://127.0.0.1:3443', acceptInvalidCerts: true }, 'desktop')

    await transport.fetchImpl('https://127.0.0.1:3443/version')

    expect(vi.mocked(pluginFetch).mock.calls[0]?.[1]).toMatchObject({
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    })
  })

  it('never adds a danger init when the flag is unset (guards against a hardcoded getTransport call)', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const transport = buildTransport({ kind: 'rest', url: 'https://127.0.0.1:3443' }, 'desktop')

    await transport.fetchImpl('https://127.0.0.1:3443/version')

    expect(vi.mocked(pluginFetch).mock.calls[0]?.[1]).toBeUndefined()
  })

  it('reports the window host in browser mode for an empty url', () => {
    expect(connectionHostLabel({ kind: 'rest', url: '' }, 'browser')).toBe(window.location.host)
  })

  it('reports the host of the stored url in browser mode', () => {
    expect(connectionHostLabel({ kind: 'rest', url: 'http://luradb.test:3000' }, 'browser')).toBe('luradb.test:3000')
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
