import { describe, expect, it } from 'vitest'
import { ARTICLES, getArticle, searchArticles } from './articles'

describe('ARTICLES registry', () => {
  it('has all ten articles with unique ids', () => {
    expect(ARTICLES).toHaveLength(10)
    const ids = ARTICLES.map((article) => article.id)
    expect(new Set(ids).size).toBe(10)
  })

  it('registers the mcp article directly after auth-permissions', () => {
    const ids = ARTICLES.map((article) => article.id)
    expect(ids.indexOf('mcp')).toBe(ids.indexOf('auth-permissions') + 1)
    const article = getArticle('mcp')
    expect(article?.category).toBe('MCP')
    expect(article?.title).toBe('Connecting AI assistants over MCP')
    expect(article?.kicker).toBe('MCP')
  })

  it('resolves both related chips of the mcp article to registered articles', () => {
    const chips = getArticle('mcp')?.chips ?? []
    expect(chips).toEqual([
      { kind: 'related', label: 'related: Auth & permissions', targetId: 'auth-permissions' },
      { kind: 'related', label: 'related: Getting started', targetId: 'getting-started' },
    ])
    for (const chip of chips) {
      if (chip.kind === 'related') expect(getArticle(chip.targetId)).toBeDefined()
    }
  })

  it('gives every article a non-empty category, title, kicker, and body', () => {
    for (const article of ARTICLES) {
      expect(article.category.length).toBeGreaterThan(0)
      expect(article.title.length).toBeGreaterThan(0)
      expect(article.kicker.length).toBeGreaterThan(0)
      expect(article.body.length).toBeGreaterThan(0)
    }
  })

  it('resolves an article by id via getArticle', () => {
    expect(getArticle('cross-engine-links')?.title).toBe('KVREF & JSONREF columns')
  })

  it('returns undefined for an unknown id', () => {
    expect(getArticle('does-not-exist')).toBeUndefined()
  })

  it('parses the try/related chip trailer', () => {
    const article = getArticle('cross-engine-links')
    expect(article?.chips).toEqual([
      { kind: 'console', label: 'try in the console →', query: 'SELECT id, customer_ref FROM orders LIMIT 5' },
      { kind: 'related', label: 'related: LuraSQL · LEFT JOIN', targetId: 'lurasql' },
      { kind: 'related', label: 'related: Errors · 409', targetId: 'errors-status-codes' },
    ])
  })
})

describe('searchArticles', () => {
  it('finds a term that only appears in an article body, not its title', () => {
    const hits = searchArticles('reindex')
    expect(hits.some((hit) => hit.article.id === 'json-documents-indexes')).toBe(true)
    expect(hits.every((hit) => !hit.article.title.toLowerCase().includes('reindex'))).toBe(true)
  })

  it('is case-insensitive and includes a context snippet around the match', () => {
    const hits = searchArticles('KVREF')
    const hit = hits.find((h) => h.article.id === 'cross-engine-links')
    expect(hit).toBeDefined()
    expect(hit?.context.toLowerCase()).toContain('kvref')
  })

  it('returns no hits for an empty or whitespace-only query', () => {
    expect(searchArticles('')).toEqual([])
    expect(searchArticles('   ')).toEqual([])
  })

  it('returns no hits when nothing matches', () => {
    expect(searchArticles('xyznonexistentterm')).toEqual([])
  })

  it('finds the mcp article for "mcp" and for "assistant"', () => {
    for (const query of ['mcp', 'assistant']) {
      expect(searchArticles(query).filter((hit) => hit.article.id === 'mcp')).toHaveLength(1)
    }
  })

  it('finds AUTOINCREMENT in the lurasql article body', () => {
    const hits = searchArticles('AUTOINCREMENT')
    expect(hits.some((hit) => hit.article.id === 'lurasql')).toBe(true)
  })
})
