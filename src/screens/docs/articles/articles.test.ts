import { describe, expect, it } from 'vitest'
import {
  ARTICLES,
  DOC_ENTRIES,
  DOCS_SITE,
  REMOTE_TOPICS,
  docsIdForSitePath,
  getArticle,
  getDocEntry,
  getRemoteTopic,
  resolveSitePage,
  searchArticles,
} from './articles'

describe('ARTICLES registry', () => {
  it('has one local article and nine remote topics with unique ids', () => {
    expect(ARTICLES).toHaveLength(1)
    expect(ARTICLES[0]?.id).toBe('getting-started')
    expect(REMOTE_TOPICS).toHaveLength(9)
    expect(DOC_ENTRIES).toHaveLength(10)
    expect(new Set(DOC_ENTRIES.map((entry) => entry.id)).size).toBe(10)
  })

  it('keeps the sidebar order of the ten topics', () => {
    expect(DOC_ENTRIES.map((entry) => entry.id)).toEqual([
      'getting-started',
      'domains-isolation',
      'kv-engine',
      'json-documents-indexes',
      'lurasql',
      'cross-engine-links',
      'auth-permissions',
      'mcp',
      'backup-restore',
      'errors-status-codes',
    ])
  })

  it('maps every remote topic to its docs.luradb.org page', () => {
    expect(DOCS_SITE).toBe('https://docs.luradb.org')
    const pages = REMOTE_TOPICS.map(({ id, path, anchor }) => ({ id, path, anchor }))
    expect(pages).toEqual([
      { id: 'domains-isolation', path: '/how-it-works/domains-and-engines/', anchor: undefined },
      { id: 'kv-engine', path: '/using/key-value/', anchor: undefined },
      { id: 'json-documents-indexes', path: '/using/json-documents/', anchor: undefined },
      { id: 'lurasql', path: '/using/lurasql/', anchor: undefined },
      { id: 'cross-engine-links', path: '/using/lurasql/', anchor: 'a-reference-can-embed-the-row-it-points-to' },
      { id: 'auth-permissions', path: '/operating/security/', anchor: undefined },
      { id: 'mcp', path: '/using/mcp-server/', anchor: undefined },
      { id: 'backup-restore', path: '/operating/backup-and-restore/', anchor: undefined },
      { id: 'errors-status-codes', path: '/reference/status-codes/', anchor: undefined },
    ])
    expect(getRemoteTopic('mcp')?.title).toBe('MCP server')
  })

  it('resolves the related chips of getting-started to registered topics', () => {
    const chips = getArticle('getting-started')?.chips ?? []
    expect(chips).toHaveLength(2)
    for (const chip of chips) {
      expect(chip.kind).toBe('related')
      expect(getDocEntry(chip.targetId)).toBeDefined()
    }
  })

  it('resolves a site path to its page and a topic path to its topic', () => {
    expect(resolveSitePage('/operating/configuration/')).toEqual({ path: '/operating/configuration/' })
    expect(resolveSitePage('cross-engine-links')).toEqual({
      path: '/using/lurasql/',
      anchor: 'a-reference-can-embed-the-row-it-points-to',
    })
    expect(resolveSitePage('nope')).toBeUndefined()
    expect(docsIdForSitePath('/using/lurasql/')).toBe('lurasql')
    expect(docsIdForSitePath('/operating/configuration/')).toBe('/operating/configuration/')
  })

  it('gives every article a non-empty category, title, kicker, and body', () => {
    for (const article of ARTICLES) {
      expect(article.category.length).toBeGreaterThan(0)
      expect(article.title.length).toBeGreaterThan(0)
      expect(article.kicker.length).toBeGreaterThan(0)
      expect(article.body.length).toBeGreaterThan(0)
    }
  })

  it('returns undefined for an unknown id', () => {
    expect(getArticle('does-not-exist')).toBeUndefined()
  })
})

describe('searchArticles', () => {
  it('finds a term from the getting-started body with a context snippet', () => {
    const hits = searchArticles('handshake')
    expect(hits.map((hit) => hit.entry.id)).toEqual(['getting-started'])
    expect(hits[0]?.context).toContain('handshake')
  })

  it('finds a remote topic by title or category with the site as context', () => {
    for (const query of ['security', 'auth & perm']) {
      expect(searchArticles(query)).toEqual([
        { entry: expect.objectContaining({ id: 'auth-permissions' }) as unknown, context: 'docs.luradb.org' },
      ])
    }
    expect(searchArticles('mcp').map((hit) => hit.entry.id)).toContain('mcp')
  })

  it('does not find a remote topic by body text', () => {
    expect(searchArticles('AUTOINCREMENT')).toEqual([])
    expect(searchArticles('reindex')).toEqual([])
  })

  it('returns no hits for an empty or whitespace-only query', () => {
    expect(searchArticles('')).toEqual([])
    expect(searchArticles('   ')).toEqual([])
  })

  it('returns no hits when nothing matches', () => {
    expect(searchArticles('xyznonexistentterm')).toEqual([])
  })
})
