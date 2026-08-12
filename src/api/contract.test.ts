import { describe, expect, it } from 'vitest'
import { BASE_PATH, CONTRACT_VERSION, MIN_SERVER_VERSION, checkCompatibility } from './contract'

describe('contract', () => {
  it('exposes the store-api base path', () => {
    expect(BASE_PATH).toBe('/store-api')
  })

  it('reads CONTRACT_VERSION from the pinned openapi.json', () => {
    expect(CONTRACT_VERSION).toEqual({ major: 0, minor: 2, patch: 0 })
  })
})

describe('checkCompatibility', () => {
  it('supports a server exactly at the minimum', () => {
    expect(checkCompatibility({ api_version: '0.1.0', server_version: MIN_SERVER_VERSION })).toEqual({
      compatible: true,
    })
  })

  it('supports any server above the minimum, regardless of api_version', () => {
    expect(checkCompatibility({ api_version: '9.9.9', server_version: '1.4.2' })).toEqual({ compatible: true })
  })

  it('rejects a server below the minimum', () => {
    const result = checkCompatibility({ api_version: '0.1.0', server_version: '0.0.9' })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/minimum supported/)
  })
})
