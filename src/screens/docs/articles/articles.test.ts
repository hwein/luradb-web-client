import { describe, expect, it } from 'vitest'
import { ARTICLES, getArticle, searchArticles } from './articles'

describe('ARTICLES registry', () => {
  it('has all nine seed articles with unique ids', () => {
    expect(ARTICLES).toHaveLength(9)
    const ids = ARTICLES.map((article) => article.id)
    expect(new Set(ids).size).toBe(9)
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
})
