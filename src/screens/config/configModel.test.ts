import { describe, expect, it } from 'vitest'
import { buildConfig, MASKED_DISPLAY, type ConfigRow } from './configModel'
import { REFERENCE_TOML } from './referenceToml'

function ok(text: string) {
  const model = buildConfig(text)
  if (!model.ok) throw new Error(`expected ok model, got error: ${model.message}`)
  return model
}

function row(model: ReturnType<typeof ok>, path: string): ConfigRow {
  const found = model.rowsByPath.get(path)
  if (found === undefined) throw new Error(`no row for ${path}`)
  return found
}

describe('buildConfig', () => {
  it('reports a parse error with a line hint instead of throwing', () => {
    const model = buildConfig('[server\nport = 1\n')
    expect(model.ok).toBe(false)
    if (!model.ok) expect(model.line).toBe(1)
  })

  it('builds the designed cards in file order with the design groupings', () => {
    const model = ok(REFERENCE_TOML)
    expect(model.cards.map((card) => card.title)).toEqual([
      '[server]',
      '[auth] · [proxy]',
      '[storage] · [buffer_pool]',
      '[lsm]',
      '[compaction] · [janitor]',
      '[domains] · [rate_limit]',
      '[log]',
    ])
  })

  it('classifies value kinds and strips the lead-section prefix from labels', () => {
    const model = ok(REFERENCE_TOML)
    expect(row(model, 'server.port')).toMatchObject({ kind: 'number', label: 'port' })
    expect(row(model, 'server.swagger_enabled')).toMatchObject({ kind: 'boolean', display: 'true' })
    expect(row(model, 'log.level')).toMatchObject({ kind: 'string', display: '"verbose"' })
    expect(row(model, 'proxy.trusted_proxies')).toMatchObject({ kind: 'array' })
  })

  it('keeps companion-section prefixes but strips the lead prefix', () => {
    const model = ok(REFERENCE_TOML)
    expect(row(model, 'auth.enabled').label).toBe('enabled')
    expect(row(model, 'proxy.trusted_proxies').label).toBe('proxy.trusted_proxies')
    expect(row(model, 'buffer_pool.pool_size').label).toBe('buffer_pool.pool_size')
  })

  it('renders the dotted [log.modules] section as its own rows', () => {
    const model = ok(REFERENCE_TOML)
    expect(row(model, 'log.modules.rel')).toMatchObject({ section: 'log.modules', key: 'rel', label: 'modules.rel' })
  })

  it('masks the changeme api_key and never leaks the raw secret into the row', () => {
    const model = ok(REFERENCE_TOML)
    const key = row(model, 'auth.admins[0].api_key')
    expect(key.masked).toBe(true)
    expect(key.display).toBe(MASKED_DISPLAY)
    expect(JSON.stringify({ display: key.display, label: key.label })).not.toContain('changeme')
  })

  it('masks by key name for secret/password-style keys', () => {
    const model = ok('[svc]\ndb_password = "hunter2"\ntoken_secret = "abc"\nname = "svc"\n')
    expect(row(model, 'svc.db_password').masked).toBe(true)
    expect(row(model, 'svc.token_secret').masked).toBe(true)
    expect(row(model, 'svc.name').masked).toBe(false)
  })
})
