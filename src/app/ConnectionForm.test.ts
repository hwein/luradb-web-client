import { describe, expect, it } from 'vitest'
import { normalizeServerUrl } from './ConnectionForm'

describe('normalizeServerUrl', () => {
  it('repariert einen fehlenden Slash nach dem Schema (http:/host)', () => {
    expect(normalizeServerUrl('http:/localhost:3000/')).toBe('http://localhost:3000')
  })

  it('entfernt trailing Slashes', () => {
    expect(normalizeServerUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000')
  })

  it('lässt eine saubere URL unverändert', () => {
    expect(normalizeServerUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
  })

  it('trimmt Whitespace', () => {
    expect(normalizeServerUrl('  http://127.0.0.1:3000  ')).toBe('http://127.0.0.1:3000')
  })

  it('lässt Unparsbares roh durch (Connect meldet dann unreachable)', () => {
    expect(normalizeServerUrl('not a url')).toBe('not a url')
  })
})
