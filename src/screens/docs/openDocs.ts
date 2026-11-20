import { openArticle, setSearch } from './docsStore'

export type DocsTarget = string | { search: string }

/**
 * Context API, callable from anywhere (409 "why?", dangling "docs", SQL toolbar "? syntax").
 * Writes only to the docs store; callers navigate to `/docs` themselves.
 */
export function openDocs(target: DocsTarget): void {
  if (typeof target === 'string') {
    openArticle(target)
    return
  }
  setSearch(target.search)
}

/** Error context to article id, kept in one place for callers (409 lines, dangling links, SQL toolbar). */
export const DOCS_FOR_CONTEXT = {
  conflict: 'errors-status-codes',
  danglingLink: 'cross-engine-links',
  sqlSyntax: 'lurasql',
} as const
