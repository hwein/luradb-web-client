import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTransport, isTauri } from './transport'

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('uses the plugin-http fetch inside the Tauri webview', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(getTransport()).toEqual({ fetchImpl: pluginFetch, defaultBaseUrl: '' })
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
