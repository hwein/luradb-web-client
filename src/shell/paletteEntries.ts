import type { DocEntry } from '../screens/docs/articles/articles'
import type { DomainSummary } from './domains'

export interface PaletteScreen {
  path: string
  title: string
}

export type PaletteEntry =
  | { kind: 'screen'; path: string; title: string }
  | { kind: 'domain'; domain: DomainSummary }
  | { kind: 'doc'; id: string; title: string; category: string }

export interface PaletteGroup {
  label: 'SCREENS' | 'DOMAINS' | 'DOCS'
  entries: PaletteEntry[]
  /** Only DOMAINS without an active session: a silent row instead of real hits. */
  emptyMessage?: string
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

/**
 * Hit computation of the command palette: case-insensitive substring match, no fuzzy scoring.
 * Does not sort itself; the input arrays already come in registry or alphabetical order.
 */
export function paletteEntries(
  query: string,
  screens: PaletteScreen[],
  domains: DomainSummary[],
  articles: DocEntry[],
  hasSession: boolean,
): PaletteGroup[] {
  const needle = query.trim().toLowerCase()

  const screenEntries: PaletteEntry[] = screens
    .filter((screen) => matches(screen.title, needle))
    .map((screen): PaletteEntry => ({ kind: 'screen', path: screen.path, title: screen.title }))

  const domainGroup: PaletteGroup = !hasSession
    ? { label: 'DOMAINS', entries: [], emptyMessage: 'connect to browse domains' }
    : {
        label: 'DOMAINS',
        entries: domains
          .filter((domain) => matches(domain.name, needle))
          .map((domain): PaletteEntry => ({ kind: 'domain', domain })),
      }

  // An empty query shows no docs (keeps the start view simple); a substring match on '' would hit every article.
  const docEntries: PaletteEntry[] =
    needle === ''
      ? []
      : articles
          .filter((article) => matches(article.title, needle) || matches(article.category, needle))
          .map((article): PaletteEntry => ({ kind: 'doc', id: article.id, title: article.title, category: article.category }))

  return [{ label: 'SCREENS', entries: screenEntries }, domainGroup, { label: 'DOCS', entries: docEntries }]
}
