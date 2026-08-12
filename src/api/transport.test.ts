import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { parse } from 'smol-toml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTransport, isTauri } from './transport'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('isTauri', () => {
  it('is false in the browser', () => {
    expect(isTauri()).toBe(false)
  })

  it('is true inside the Tauri webview', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(isTauri()).toBe(true)
  })
})

describe('getTransport', () => {
  it('uses native fetch in the browser', () => {
    expect(getTransport()).toEqual({ fetchImpl: fetch, defaultBaseUrl: '' })
  })

  it('ignores acceptInvalidCerts in the browser', () => {
    expect(getTransport({ acceptInvalidCerts: true })).toEqual({ fetchImpl: fetch, defaultBaseUrl: '' })
  })

  it('uses the plugin-http fetch inside the Tauri webview', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(getTransport()).toEqual({ fetchImpl: pluginFetch, defaultBaseUrl: '' })
  })

  it('returns the plugin-http fetch unchanged when acceptInvalidCerts is false', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(getTransport({ acceptInvalidCerts: false }).fetchImpl).toBe(pluginFetch)
  })

  it('passes calls through without a danger field when acceptInvalidCerts is off', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const { fetchImpl } = getTransport({ acceptInvalidCerts: false })

    await fetchImpl('http://127.0.0.1:3000/version')

    expect(vi.mocked(pluginFetch).mock.calls[0]?.[1]).toBeUndefined()
  })

  describe('with acceptInvalidCerts: true', () => {
    it('adds danger with both fields to every call, preserving the rest of init', async () => {
      vi.stubGlobal('__TAURI_INTERNALS__', {})
      const { fetchImpl } = getTransport({ acceptInvalidCerts: true })

      await fetchImpl('https://127.0.0.1:3443/version', { method: 'GET', headers: { accept: 'application/json' } })

      expect(vi.mocked(pluginFetch).mock.calls[0]?.[1]).toMatchObject({
        method: 'GET',
        headers: { accept: 'application/json' },
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
      })
    })

    it('works when called with a Request object and no init', async () => {
      vi.stubGlobal('__TAURI_INTERNALS__', {})
      const { fetchImpl } = getTransport({ acceptInvalidCerts: true })
      const request = new Request('https://127.0.0.1:3443/version')

      await fetchImpl(request)

      const call = vi.mocked(pluginFetch).mock.calls[0]
      expect(call?.[0]).toBe(request)
      expect(call?.[1]).toMatchObject({ danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } })
    })
  })
})

describe('desktop capability file', () => {
  const path = resolve(process.cwd(), 'src-tauri/capabilities/default.json')
  const capability: { identifier: string; windows: string[]; permissions: unknown[] } = JSON.parse(
    readFileSync(path, 'utf-8'),
  )

  it('applies to the main window', () => {
    expect(capability.identifier).toBe('default')
    expect(capability.windows).toEqual(['main'])
  })

  it('grants the http plugin an unrestricted http/https scope, including explicit ports', () => {
    // `http://**` allein erzwingt in der URLPattern-Semantik den Default-Port — `:*` ist für z. B. :3000 zwingend.
    expect(capability.permissions).toContainEqual({
      identifier: 'http:default',
      allow: [{ url: 'http://**:*' }, { url: 'https://**:*' }],
    })
  })
})

describe('desktop cargo manifest', () => {
  const manifestPath = resolve(process.cwd(), 'src-tauri/Cargo.toml')
  const manifest = parse(readFileSync(manifestPath, 'utf-8')) as unknown as {
    dependencies: { 'tauri-plugin-http': { features?: string[] } }
  }

  it('enables the dangerous-settings feature for tauri-plugin-http — without it every flagged connection fails at runtime', () => {
    expect(manifest.dependencies['tauri-plugin-http'].features).toContain('dangerous-settings')
  })
})
