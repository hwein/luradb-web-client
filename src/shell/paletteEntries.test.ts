import { describe, expect, it } from 'vitest'
import type { ArticleMeta } from '../screens/docs/articles/articles'
import type { DomainSummary } from './domains'
import { paletteEntries, type PaletteScreen } from './paletteEntries'

const SCREENS: PaletteScreen[] = [
  { path: '/sql', title: 'LuraSQL console' },
  { path: '/data', title: 'Data browser' },
  { path: '/rest', title: 'REST Explorer' },
]

const DOMAINS: DomainSummary[] = [
  { name: 'analytics', engines: { rel: { state: 'active' } } },
  { name: 'shop', engines: { kv: true, json: { state: 'active' } } },
]

const ARTICLES: ArticleMeta[] = [
  { id: 'getting-started', category: 'Getting started', title: 'Connect to a running server', kicker: 'k' },
  { id: 'backup-restore', category: 'Backup & restore', title: 'Export today, scheduled backup on the roadmap', kicker: 'k' },
]

describe('paletteEntries', () => {
  it('groups hits into SCREENS, DOMAINS, DOCS in that order', () => {
    const groups = paletteEntries('', SCREENS, DOMAINS, ARTICLES, true)
    expect(groups.map((group) => group.label)).toEqual(['SCREENS', 'DOMAINS', 'DOCS'])
  })

  it('empty query shows all screens and domains (registry/alphabetical order) but no docs', () => {
    const [screens, domains, docs] = paletteEntries('', SCREENS, DOMAINS, ARTICLES, true)

    expect(screens!.entries).toEqual(SCREENS.map((screen) => ({ kind: 'screen', path: screen.path, title: screen.title })))
    expect(domains!.entries).toEqual(DOMAINS.map((domain) => ({ kind: 'domain', domain })))
    expect(docs!.entries).toEqual([])
  })

  it('matches screens by title, case-insensitively, substring', () => {
    const [screens] = paletteEntries('sql', SCREENS, DOMAINS, ARTICLES, true)
    expect(screens!.entries).toEqual([{ kind: 'screen', path: '/sql', title: 'LuraSQL console' }])
  })

  it('matches domains by name, case-insensitively, substring', () => {
    const [, domains] = paletteEntries('SHO', SCREENS, DOMAINS, ARTICLES, true)
    expect(domains!.entries).toEqual([{ kind: 'domain', domain: DOMAINS[1] }])
  })

  it('matches docs by title or by category', () => {
    const [, , byTitle] = paletteEntries('scheduled backup', SCREENS, DOMAINS, ARTICLES, true)
    expect(byTitle!.entries).toEqual([{ kind: 'doc', id: 'backup-restore', title: ARTICLES[1]!.title, category: 'Backup & restore' }])

    const [, , byCategory] = paletteEntries('getting started', SCREENS, DOMAINS, ARTICLES, true)
    expect(byCategory!.entries).toEqual([{ kind: 'doc', id: 'getting-started', title: ARTICLES[0]!.title, category: 'Getting started' }])
  })

  it('shows a silent "connect to browse domains" row instead of matches when there is no active session', () => {
    const [, domains] = paletteEntries('shop', SCREENS, DOMAINS, ARTICLES, false)
    expect(domains!.entries).toEqual([])
    expect(domains!.emptyMessage).toBe('connect to browse domains')
  })

  it('has no empty-domains message once connected, even when nothing matches', () => {
    const [, domains] = paletteEntries('no-such-domain', SCREENS, DOMAINS, ARTICLES, true)
    expect(domains!.entries).toEqual([])
    expect(domains!.emptyMessage).toBeUndefined()
  })
})
