import { describe, expect, it } from 'vitest'
import { BASE_PATH, CONTRACT_VERSION, checkCompatibility } from './contract'

describe('contract', () => {
  it('exposes the store-api base path', () => {
    expect(BASE_PATH).toBe('/store-api')
  })

  it('reads CONTRACT_VERSION from the pinned openapi.json', () => {
    expect(CONTRACT_VERSION).toEqual({ major: 0, minor: 1, patch: 0 })
  })
})

describe('checkCompatibility', () => {
  it('is compatible when the server matches the contract version exactly', () => {
    expect(checkCompatibility({ api_version: '0.1.0', server_version: '0.1.0' })).toEqual({ compatible: true })
  })

  it('is compatible with a note when the server has a newer minor version', () => {
    const result = checkCompatibility({ api_version: '0.2.0', server_version: '0.2.0' })
    expect(result.compatible).toBe(true)
    expect(result.reason).toMatch(/newer/)
  })

  it('is incompatible when the server is older than the contract', () => {
    const result = checkCompatibility({ api_version: '0.0.9', server_version: '0.0.9' })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/older/)
  })

  it('is incompatible on a foreign major version', () => {
    const result = checkCompatibility({ api_version: '1.0.0', server_version: '1.0.0' })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/major/)
  })
})
