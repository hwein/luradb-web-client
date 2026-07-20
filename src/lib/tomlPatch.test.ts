import { describe, expect, it } from 'vitest'
import { REFERENCE_TOML } from '../screens/config/referenceToml'
import { patchToml, serializeTomlValue, splitTomlPath } from './tomlPatch'

function line(text: string, startsWith: string): string {
  const found = text.split('\n').find((row) => row.trimStart().startsWith(startsWith))
  if (found === undefined) throw new Error(`no line starting with ${startsWith}`)
  return found
}

function changedLines(before: string, after: string): string[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const changed: string[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) if (a[i] !== b[i]) changed.push(`${a[i] ?? ''} => ${b[i] ?? ''}`)
  return changed
}

describe('serializeTomlValue', () => {
  it('serializes each scalar type TOML-conformantly', () => {
    expect(serializeTomlValue(3001)).toBe('3001')
    expect(serializeTomlValue(0.5)).toBe('0.5')
    expect(serializeTomlValue(true)).toBe('true')
    expect(serializeTomlValue(false)).toBe('false')
    expect(serializeTomlValue('/test-ui')).toBe('"/test-ui"')
  })

  it('escapes backslashes and quotes in strings', () => {
    expect(serializeTomlValue('he said "hi"\\path')).toBe('"he said \\"hi\\"\\\\path"')
  })
})

describe('splitTomlPath', () => {
  it('splits at the last dot so dotted sections stay intact', () => {
    expect(splitTomlPath('server.port')).toEqual({ section: 'server', key: 'port' })
    expect(splitTomlPath('log.modules.rel')).toEqual({ section: 'log.modules', key: 'rel' })
    expect(splitTomlPath('title')).toEqual({ section: '', key: 'title' })
  })
})

describe('patchToml', () => {
  it('replaces a value inside its section block and keeps the inline comment + alignment', () => {
    const out = patchToml(REFERENCE_TOML, [{ section: 'server', key: 'port', value: 3001 }])
    expect(line(out, 'port')).toBe('port = 3001            # HTTP listen port')
  })

  it('patches the key in the correct block only (does not touch same-named keys elsewhere)', () => {
    const out = patchToml(REFERENCE_TOML, [{ section: 'log', key: 'level', value: 'info' }])
    expect(line(out, 'level =')).toBe('level = "info"')
    // log.modules.rel is also a log level value but must be untouched
    expect(out).toContain('rel = "info"')
    expect(changedLines(REFERENCE_TOML, out)).toEqual(['level = "verbose" => level = "info"'])
  })

  it('un-comments a commented-out key when it is set, preserving the trailing comment', () => {
    const out = patchToml(REFERENCE_TOML, [{ section: 'log', key: 'path', value: '/tmp/luradb.log' }])
    expect(line(out, 'path =')).toBe('path = "/tmp/luradb.log"   # stdout when unset')
    // the other commented key stays commented
    expect(out).toContain('# workers = 4          # auto-detected when unset')
  })

  it('appends a missing key at the section end, before trailing blank lines', () => {
    const out = patchToml(REFERENCE_TOML, [{ section: 'server', key: 'max_connections', value: 200 }])
    const lines = out.split('\n')
    const serverIdx = lines.indexOf('[server]')
    const authIdx = lines.indexOf('[auth]')
    const insertedIdx = lines.indexOf('max_connections = 200')
    expect(insertedIdx).toBeGreaterThan(serverIdx)
    expect(insertedIdx).toBeLessThan(authIdx)
    // inserted after the last real line of the block, not after the blank separator
    expect(lines[insertedIdx - 1]).toBe('# workers = 4          # auto-detected when unset')
    expect(lines[insertedIdx + 1]).toBe('')
  })

  it('serializes strings with escaping when patching', () => {
    const out = patchToml(REFERENCE_TOML, [{ section: 'storage', key: 'db_path', value: 'c:\\data\\"db"' }])
    expect(line(out, 'db_path')).toBe('db_path = "c:\\\\data\\\\\\"db\\""')
  })

  it('patches a dotted section block ([log.modules]) independently of its parent', () => {
    const out = patchToml(REFERENCE_TOML, [{ section: 'log.modules', key: 'rel', value: 'verbose' }])
    expect(line(out, 'rel =')).toBe('rel = "verbose"')
    expect(line(out, 'level =')).toBe('level = "verbose"') // [log].level untouched
  })

  it('applies multiple edits and leaves every other line identical', () => {
    const out = patchToml(REFERENCE_TOML, [
      { section: 'server', key: 'port', value: 3001 },
      { section: 'log', key: 'level', value: 'info' },
      { section: 'server', key: 'swagger_enabled', value: false },
    ])
    expect(changedLines(REFERENCE_TOML, out)).toEqual([
      'port = 3000            # HTTP listen port => port = 3001            # HTTP listen port',
      'swagger_enabled = true => swagger_enabled = false',
      'level = "verbose" => level = "info"',
    ])
  })

  it('preserves CRLF line endings', () => {
    const crlf = REFERENCE_TOML.replace(/\n/g, '\r\n')
    const out = patchToml(crlf, [{ section: 'server', key: 'port', value: 3001 }])
    expect(out).toContain('\r\n')
    expect(out).not.toContain('\n\n') // no stray LF-only breaks introduced
    expect(out.split('\r\n').find((row) => row.startsWith('port'))).toBe('port = 3001            # HTTP listen port')
  })
})
