import { compareSemVer, parseSemVer } from './contract'
import type { SemVer } from './contract'
import serverChangelogRaw from './server-changelog.md?raw'

export type SectionKey = 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security'

export interface ChangelogEntry {
  text: string
  api: boolean
  breaking: boolean
}

export interface ChangelogSection {
  key: SectionKey
  entries: ChangelogEntry[]
}

export interface ChangelogRelease {
  version: string
  date: string
  sections: ChangelogSection[]
}

/** Releases newest first. */
export interface ServerChangelog {
  releases: ChangelogRelease[]
}

const SECTION_KEYS: SectionKey[] = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security']
const RELEASE_HEADING = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/

interface ReleaseDraft {
  version: string
  date: string
  semVer: SemVer
  sections: Map<SectionKey, string[]>
}

function isSectionKey(name: string): name is SectionKey {
  return SECTION_KEYS.some((key) => key === name)
}

function readSemVer(version: string): SemVer | null {
  try {
    return parseSemVer(version)
  } catch {
    return null
  }
}

function toEntry(raw: string): ChangelogEntry | null {
  let text = raw
  const breakingMarker = /^\*\*BREAKING\*\*:?(?: |$)/.exec(text)
  const breaking = breakingMarker !== null
  if (breakingMarker) text = text.slice(breakingMarker[0].length).trimStart()
  const api = /^API:(?: |$)/.test(text)
  if (api) text = text.slice('API:'.length).trimStart()
  return text === '' ? null : { text, api, breaking }
}

function toRelease(draft: ReleaseDraft): ChangelogRelease {
  const sections = SECTION_KEYS.flatMap((key): ChangelogSection[] => {
    const entries = (draft.sections.get(key) ?? [])
      .map(toEntry)
      .filter((entry): entry is ChangelogEntry => entry !== null)
    return entries.length > 0 ? [{ key, entries }] : []
  })
  return { version: draft.version, date: draft.date, sections }
}

export function parseServerChangelog(markdown: string): ServerChangelog | null {
  const drafts: ReleaseDraft[] = []
  let release: ReleaseDraft | null = null
  let section: string[] | null = null
  let entryOpen = false

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const [, version, date] = RELEASE_HEADING.exec(line) ?? []
      const semVer = version ? readSemVer(version) : null
      release = version && date && semVer ? { version, date, semVer, sections: new Map() } : null
      if (release) drafts.push(release)
      section = null
      entryOpen = false
    } else if (line.startsWith('### ')) {
      const name = line.slice(4).trim().toLowerCase()
      section = null
      if (release && isSectionKey(name)) {
        section = release.sections.get(name) ?? []
        release.sections.set(name, section)
      }
      entryOpen = false
    } else if (/^#+ /.test(line) || line.trim() === '') {
      entryOpen = false
    } else if (section && line.startsWith('- ')) {
      section.push(line.slice(2).trim())
      entryOpen = true
    } else if (section && entryOpen) {
      section.push(`${section.pop() ?? ''} ${line.trim()}`)
    }
  }

  const releases = drafts
    .map((draft) => ({ semVer: draft.semVer, release: toRelease(draft) }))
    .filter(({ release: { sections } }) => sections.length > 0)
    .sort((a, b) => compareSemVer(b.semVer, a.semVer))
    .map(({ release }) => release)
  return releases.length > 0 ? { releases } : null
}

export const serverChangelog: ServerChangelog | null = parseServerChangelog(serverChangelogRaw)
