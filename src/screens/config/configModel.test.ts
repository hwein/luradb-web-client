import { describe, expect, it } from 'vitest'
import { applyPending, applyRowEdit, buildConfig, MASKED_DISPLAY, type ConfigRow, type PendingChange } from './configModel'
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
    expect(row(model, 'server.port')).toMatchObject({ kind: 'number', label: 'port', editable: true })
    expect(row(model, 'server.swagger_enabled')).toMatchObject({ kind: 'boolean', display: 'true', editable: true })
    expect(row(model, 'log.level')).toMatchObject({ kind: 'enum', enumOptions: ['info', 'verbose', 'prod'] })
    expect(row(model, 'proxy.trusted_proxies')).toMatchObject({ kind: 'array', editable: false })
  })

  it('keeps companion-section prefixes but strips the lead prefix', () => {
    const model = ok(REFERENCE_TOML)
    expect(row(model, 'auth.enabled').label).toBe('enabled')
    expect(row(model, 'proxy.trusted_proxies').label).toBe('proxy.trusted_proxies')
    expect(row(model, 'buffer_pool.pool_size').label).toBe('buffer_pool.pool_size')
  })

  it('renders the dotted [log.modules] section as its own editable rows', () => {
    const model = ok(REFERENCE_TOML)
    expect(row(model, 'log.modules.rel')).toMatchObject({ section: 'log.modules', key: 'rel', editable: true, label: 'modules.rel' })
  })

  it('masks the changeme api_key and never leaks the raw secret into the row', () => {
    const model = ok(REFERENCE_TOML)
    const key = row(model, 'auth.admins[0].api_key')
    expect(key.masked).toBe(true)
    expect(key.editable).toBe(false) // inside an array-of-tables
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

describe('applyRowEdit diff lifecycle', () => {
  it('adds, updates and (on reset to old) removes an entry — type-aware (0 !== "0")', () => {
    let diff = applyRowEdit(new Map<string, PendingChange>(), 'server.port', 3000, 3001)
    expect(diff.get('server.port')).toEqual({ old: 3000, new: 3001 })

    diff = applyRowEdit(diff, 'server.port', 3000, 3002)
    expect(diff.get('server.port')).toEqual({ old: 3000, new: 3002 })

    diff = applyRowEdit(diff, 'server.port', 3000, 3000)
    expect(diff.has('server.port')).toBe(false)
  })

  it('treats a numeric old value and a string new value as different', () => {
    const diff = applyRowEdit(new Map<string, PendingChange>(), 'x.n', 0, '0')
    expect(diff.has('x.n')).toBe(true)
  })
})

describe('applyPending', () => {
  it('produces a download text that differs only in the edited lines', () => {
    const diff = new Map<string, PendingChange>([
      ['server.port', { old: 3000, new: 3001 }],
      ['log.level', { old: 'verbose', new: 'info' }],
    ])
    const out = applyPending(REFERENCE_TOML, diff)
    const before = REFERENCE_TOML.split('\n')
    const after = out.split('\n')
    const diffs = before.map((l, i) => [l, after[i]] as const).filter(([a, b]) => a !== b)
    expect(diffs).toEqual([
      ['port = 3000            # HTTP listen port', 'port = 3001            # HTTP listen port'],
      ['level = "verbose"', 'level = "info"'],
    ])
  })
})
