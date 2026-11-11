import { describe, expect, it } from 'vitest'
import { parseServerChangelog } from './serverChangelog'

const md = (...lines: string[]) => lines.join('\n')

describe('parseServerChangelog', () => {
  it('returns the releases newest first', () => {
    const changelog = parseServerChangelog(
      md('## [0.5.1] - 2026-11-03', '### Fixed', '- a', '', '## [0.7.1] - 2026-11-09', '### Fixed', '- b'),
    )
    expect(changelog?.releases.map((release) => release.version)).toEqual(['0.7.1', '0.5.1'])
  })

  it('reads version and date from a release heading', () => {
    const changelog = parseServerChangelog(md('## [0.7.0] - 2026-11-09', '', '### Added', '', '- a'))
    expect(changelog?.releases[0]).toMatchObject({ version: '0.7.0', date: '2026-11-09' })
  })

  it('skips the Unreleased heading and any other second-level heading', () => {
    const changelog = parseServerChangelog(
      md(
        '# Changelog',
        '## [Unreleased]',
        '### Added',
        '- unreleased',
        '## [0.7.1] - 2026-11-09',
        '### Added',
        '- released',
        '## Notes',
        '### Added',
        '- note',
      ),
    )
    expect(changelog).toEqual({
      releases: [
        {
          version: '0.7.1',
          date: '2026-11-09',
          sections: [{ key: 'added', entries: [{ text: 'released', api: false, breaking: false }] }],
        },
      ],
    })
  })

  it('returns the non-empty sections of a release in the fixed order', () => {
    const changelog = parseServerChangelog(
      md('## [0.7.1] - 2026-11-09', '### Fixed', '- f', '### Changed', '', '### ADDED', '- a', '### Fixed', '- g'),
    )
    expect(changelog?.releases[0]?.sections).toEqual([
      { key: 'added', entries: [{ text: 'a', api: false, breaking: false }] },
      {
        key: 'fixed',
        entries: [
          { text: 'f', api: false, breaking: false },
          { text: 'g', api: false, breaking: false },
        ],
      },
    ])
  })

  it('ignores entries under an unknown third-level heading', () => {
    const changelog = parseServerChangelog(
      md('## [0.7.1] - 2026-11-09', '### Internal', '- hidden', '### Added', '- shown'),
    )
    expect(changelog?.releases[0]?.sections).toEqual([
      { key: 'added', entries: [{ text: 'shown', api: false, breaking: false }] },
    ])
  })

  it('marks an entry as breaking and api from its leading markers and strips them', () => {
    const changelog = parseServerChangelog(
      md(
        '## [0.7.1] - 2026-11-09',
        '### Changed',
        '- **BREAKING** API: x',
        '- **BREAKING** y',
        '- API: z',
        '- w',
        '- **BREAKING**: v',
      ),
    )
    expect(changelog?.releases[0]?.sections[0]?.entries).toEqual([
      { text: 'x', api: true, breaking: true },
      { text: 'y', api: false, breaking: true },
      { text: 'z', api: true, breaking: false },
      { text: 'w', api: false, breaking: false },
      { text: 'v', api: false, breaking: true },
    ])
  })

  it('joins continuation lines into the entry text', () => {
    const changelog = parseServerChangelog(
      md('## [0.7.1] - 2026-11-09', '### Added', '- first', '  second', 'third', '- next', '', 'after blank'),
    )
    expect(changelog?.releases[0]?.sections[0]?.entries.map((entry) => entry.text)).toEqual([
      'first second third',
      'next',
    ])
  })

  it('drops an entry that is empty after its markers', () => {
    const changelog = parseServerChangelog(
      md('## [0.7.1] - 2026-11-09', '### Added', '- **BREAKING** API:', '- **BREAKING**', '- kept'),
    )
    expect(changelog?.releases[0]?.sections[0]?.entries).toEqual([{ text: 'kept', api: false, breaking: false }])
  })

  it('drops a release without entries', () => {
    const changelog = parseServerChangelog(
      md('## [0.7.1] - 2026-11-09', '### Added', '', '## [0.7.0] - 2026-11-09', '### Added', '- a'),
    )
    expect(changelog?.releases.map((release) => release.version)).toEqual(['0.7.0'])
  })

  it('skips a release heading whose version is not a semantic version', () => {
    const changelog = parseServerChangelog(
      md('## [next] - 2026-11-10', '### Added', '- skipped', '## [0.7.1] - 2026-11-09', '### Added', '- a'),
    )
    expect(changelog?.releases).toEqual([
      { version: '0.7.1', date: '2026-11-09', sections: [{ key: 'added', entries: [{ text: 'a', api: false, breaking: false }] }] },
    ])
  })

  it('returns null for a text without a release', () => {
    expect(parseServerChangelog('')).toBeNull()
    expect(parseServerChangelog(md('# Changelog', '', '## [Unreleased]', '### Added', '- a'))).toBeNull()
  })

  it('reads a text with CRLF line endings like one with LF line endings', () => {
    const lines = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [0.7.1] - 2026-11-09',
      '',
      '### Changed',
      '',
      '- **BREAKING** API: x',
      '  continued',
      '',
      '[0.7.1]: reference',
    ]
    const lf = parseServerChangelog(lines.join('\n'))
    const crlf = parseServerChangelog(lines.join('\r\n'))
    expect(lf).not.toBeNull()
    expect(crlf).toEqual(lf)
    const release = crlf?.releases[0]
    expect(release?.version).not.toContain('\r')
    expect(release?.date).not.toContain('\r')
    expect(release?.sections[0]?.entries[0]?.text).toBe('x continued')
  })
})
