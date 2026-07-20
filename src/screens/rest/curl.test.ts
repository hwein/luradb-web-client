import { describe, expect, it } from 'vitest'
import { buildCurl } from './curl'

describe('buildCurl', () => {
  it('uses the $LURADB_KEY placeholder, never a real key', () => {
    const curl = buildCurl({ baseUrl: 'http://127.0.0.1:3000', method: 'GET', path: '/store-api/domains', hasBody: false, body: '' })
    expect(curl).toContain("curl -X GET 'http://127.0.0.1:3000/store-api/domains'")
    expect(curl).toContain('-H "Authorization: Bearer $LURADB_KEY"')
    expect(curl).not.toContain('-d')
  })

  it('adds Content-Type and the body for requests that carry one', () => {
    const curl = buildCurl({
      baseUrl: 'http://127.0.0.1:3000',
      method: 'POST',
      path: '/store-api/json/shop/search',
      hasBody: true,
      body: '{"limit":50}',
    })
    expect(curl).toContain("curl -X POST 'http://127.0.0.1:3000/store-api/json/shop/search'")
    expect(curl).toContain('-H "Authorization: Bearer $LURADB_KEY"')
    expect(curl).toContain('-H "Content-Type: application/json"')
    expect(curl).toContain(`-d '{"limit":50}'`)
  })

  it('omits the body block when there is no body', () => {
    const curl = buildCurl({ baseUrl: 'http://x', method: 'POST', path: '/p', hasBody: true, body: '' })
    expect(curl).not.toContain('Content-Type')
    expect(curl).not.toContain('-d')
  })
})
