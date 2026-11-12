import { describe, expect, it } from 'vitest'
import { isCrossOrigin, isMixedContentBlocked } from './crossOrigin'

describe('crossOrigin', () => {
  it('isCrossOrigin is false for the same origin', () => {
    expect(isCrossOrigin('http://localhost:5173', 'http://localhost:5173')).toBe(false)
    expect(isCrossOrigin('http://localhost:5173', 'http://localhost:5173/store-api')).toBe(false)
  })

  it('isCrossOrigin is true for a different port, host or scheme', () => {
    expect(isCrossOrigin('http://localhost:5173', 'http://localhost:3000')).toBe(true)
    expect(isCrossOrigin('http://localhost:5173', 'http://luradb.test:5173')).toBe(true)
    expect(isCrossOrigin('http://localhost:5173', 'https://localhost:5173')).toBe(true)
  })

  it('isMixedContentBlocked is true for an https page and a non-loopback http target', () => {
    expect(isMixedContentBlocked('https://client.example/app', 'http://luradb.test:3000')).toBe(true)
  })

  it('isMixedContentBlocked is false for an https page and a loopback http target', () => {
    expect(isMixedContentBlocked('https://client.example/', 'http://localhost:3000')).toBe(false)
    expect(isMixedContentBlocked('https://client.example/', 'http://127.0.0.1:3000')).toBe(false)
    expect(isMixedContentBlocked('https://client.example/', 'http://[::1]:3000')).toBe(false)
  })

  it('isMixedContentBlocked is false for an http page and an http target', () => {
    expect(isMixedContentBlocked('http://client.example/', 'http://luradb.test:3000')).toBe(false)
  })

  it('both rules return false for unparsable input', () => {
    expect(isCrossOrigin('not a url', 'http://luradb.test:3000')).toBe(false)
    expect(isCrossOrigin('http://localhost:5173', 'not a url')).toBe(false)
    expect(isMixedContentBlocked('not a url', 'http://luradb.test:3000')).toBe(false)
    expect(isMixedContentBlocked('https://client.example/', 'not a url')).toBe(false)
  })
})
