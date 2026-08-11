import type { ArticleMeta } from '../screens/docs/articles/articles'
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
  /** Nur DOMAINS ohne aktive Session (spec shell/008 §5): stumme Zeile statt echter Treffer. */
  emptyMessage?: string
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

/**
 * Trefferberechnung der Command-Palette (spec shell/008 §3/§6): case-insensitiver Substring-Match, kein
 * Fuzzy-Scoring. Sortiert nicht selbst — Eingabe-Arrays liefern bereits Registry- bzw. Alphabet-Reihenfolge.
 */
export function paletteEntries(
  query: string,
  screens: PaletteScreen[],
  domains: DomainSummary[],
  articles: ArticleMeta[],
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

  // Leere Eingabe zeigt keine Docs (KISS-Startbild, spec §2) — ein Substring-Match auf '' träfe sonst alle Artikel.
  const docEntries: PaletteEntry[] =
    needle === ''
      ? []
      : articles
          .filter((article) => matches(article.title, needle) || matches(article.category, needle))
          .map((article): PaletteEntry => ({ kind: 'doc', id: article.id, title: article.title, category: article.category }))

  return [{ label: 'SCREENS', entries: screenEntries }, domainGroup, { label: 'DOCS', entries: docEntries }]
}
