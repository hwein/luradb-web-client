import { openArticle, setSearch } from './docsStore'

export type DocsTarget = string | { search: string }

/**
 * Kontext-API (spec docs/001 §6): von überall aufrufbar (409-„why?", Dangling-„docs", SQL-Toolbar
 * „? syntax"). Schreibt nur in den Docs-Store — Aufrufer navigieren selbst zu `/docs`.
 */
export function openDocs(target: DocsTarget): void {
  if (typeof target === 'string') {
    openArticle(target)
    return
  }
  setSearch(target.search)
}

/** Fehlerkontext → Artikel-Id, zentral gepflegt für künftige Aufrufer (409-Zeilen, Dangling-Links, SQL-Toolbar). */
export const DOCS_FOR_CONTEXT = {
  conflict: 'errors-status-codes',
  danglingLink: 'cross-engine-links',
  sqlSyntax: 'lurasql',
} as const
