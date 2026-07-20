import { describe, expect, it } from 'vitest'
import type { HttpMethod } from './endpoints'
import { applyPathParams, isDestructive, listEndpointGroups, methodTone, pathParamNames } from './endpoints'

const ALL = listEndpointGroups().flatMap((group) => group.endpoints)

function find(method: HttpMethod, path: string) {
  return ALL.find((endpoint) => endpoint.method === method && endpoint.path === path)
}

describe('listEndpointGroups', () => {
  it('groups endpoints by contract tag and keeps known paths', () => {
    const tags = listEndpointGroups().map((group) => group.tag)
    expect(tags).toContain('Key-Value Store')
    expect(tags).toContain('JSON Document Store')
    expect(tags).toContain('Domains')

    expect(find('GET', '/store-api/kv/{domain}/keys/{key}')).toBeDefined()
    expect(find('POST', '/store-api/json/{domain}/search')).toBeDefined()
    expect(find('GET', '/store-api/domains')).toBeDefined()
  })

  it('shortens the display path by stripping the BASE_PATH prefix', () => {
    expect(find('GET', '/store-api/kv/{domain}/keys/{key}')?.displayPath).toBe('/kv/{domain}/keys/{key}')
    // Pfade außerhalb von /store-api bleiben unverändert.
    expect(find('GET', '/version')?.displayPath).toBe('/version')
  })

  it('flags a body only for operations that declare a request body', () => {
    expect(find('GET', '/store-api/domains')?.hasBody).toBe(false)
    expect(find('DELETE', '/store-api/kv/{domain}/keys/{key}')?.hasBody).toBe(false)
    expect(find('POST', '/store-api/json/{domain}/search')?.hasBody).toBe(true)
    expect(find('PUT', '/store-api/kv/{domain}/keys/{key}')?.hasBody).toBe(true)
  })

  it('builds a minimal body example from required fields only', () => {
    expect(find('POST', '/store-api/domains')?.bodyExample).toBe(JSON.stringify({ name: '' }, null, 2))
    expect(find('POST', '/store-api/rel/{domain}/sql')?.bodyExample).toBe(JSON.stringify({ sql: '' }, null, 2))
    // SearchRequest hat keine required-Felder -> leeres Objekt.
    expect(find('POST', '/store-api/json/{domain}/search')?.bodyExample).toBe('{}')
    // KV-PUT-Body ist ein roher String (text/plain) -> "" als Minimal-Beispiel.
    expect(find('PUT', '/store-api/kv/{domain}/keys/{key}')?.bodyExample).toBe('""')
  })
})

describe('pathParamNames', () => {
  it('extracts template parameters in order', () => {
    expect(pathParamNames('/store-api/kv/{domain}/keys/{key}')).toEqual(['domain', 'key'])
    expect(pathParamNames('/store-api/domains')).toEqual([])
  })
})

describe('applyPathParams', () => {
  it('substitutes filled parameters and url-encodes them', () => {
    expect(applyPathParams('/store-api/kv/{domain}/keys/{key}', { domain: 'default', key: 'test' })).toBe(
      '/store-api/kv/default/keys/test',
    )
    expect(applyPathParams('/store-api/kv/{domain}/keys/{key}', { domain: 'd', key: 'a b' })).toBe('/store-api/kv/d/keys/a%20b')
  })

  it('leaves empty or missing parameters visible as templates', () => {
    expect(applyPathParams('/store-api/kv/{domain}/keys/{key}', { domain: 'default', key: '' })).toBe(
      '/store-api/kv/default/keys/{key}',
    )
    expect(applyPathParams('/store-api/kv/{domain}/keys/{key}', {})).toBe('/store-api/kv/{domain}/keys/{key}')
  })
})

describe('methodTone', () => {
  it('maps methods to the design color tones', () => {
    expect(methodTone('GET')).toBe('acc')
    expect(methodTone('POST')).toBe('json')
    expect(methodTone('PUT')).toBe('json')
    expect(methodTone('PATCH')).toBe('json')
    expect(methodTone('DELETE')).toBe('err')
  })
})

describe('isDestructive', () => {
  it('treats DELETE and rotate-key paths as destructive', () => {
    expect(isDestructive('DELETE', '/store-api/kv/{domain}/keys/{key}')).toBe(true)
    expect(isDestructive('POST', '/store-api/auth/users/{name}/rotate-key')).toBe(true)
    expect(isDestructive('GET', '/store-api/domains')).toBe(false)
    expect(isDestructive('POST', '/store-api/json/{domain}/search')).toBe(false)
  })
})
