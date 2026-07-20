import authPermissionsRaw from './auth-permissions.md?raw'
import backupRestoreRaw from './backup-restore.md?raw'
import crossEngineLinksRaw from './cross-engine-links.md?raw'
import domainsIsolationRaw from './domains-isolation.md?raw'
import errorsStatusCodesRaw from './errors-status-codes.md?raw'
import gettingStartedRaw from './getting-started.md?raw'
import jsonDocumentsIndexesRaw from './json-documents-indexes.md?raw'
import kvEngineRaw from './kv-engine.md?raw'
import lurasqlRaw from './lurasql.md?raw'

export interface ArticleMeta {
  id: string
  category: string
  title: string
  kicker: string
}

export type ArticleChip = { kind: 'console'; label: string; query: string } | { kind: 'related'; label: string; targetId: string }

export interface Article extends ArticleMeta {
  /** Markdown-Rumpf ohne Frontmatter/Chip-Trailer — Eingabe für den Renderer (markdown.ts). */
  body: string
  chips: ArticleChip[]
}

interface RawSections {
  header: string
  body: string
  trailer: string | undefined
}

// Frontmatter/Chip-Trailer trennen zwei Zeilen, die exakt "---" sind — Beispiel-Codeblöcke dürfen daher
// selbst keine solche Zeile enthalten.
function splitSections(raw: string): RawSections {
  const lines = raw.split(/\r?\n/)
  const delimiters: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') delimiters.push(i)
  }
  const [first, second] = delimiters
  if (first === undefined) throw new Error('article is missing the frontmatter delimiter (---)')
  return {
    header: lines.slice(0, first).join('\n'),
    body: lines.slice(first + 1, second).join('\n'),
    trailer: second === undefined ? undefined : lines.slice(second + 1).join('\n'),
  }
}

function parseHeader(headerText: string): ArticleMeta {
  const fields = new Map<string, string>()
  for (const line of headerText.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const sep = line.indexOf(':')
    if (sep === -1) continue
    fields.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim())
  }
  const id = fields.get('id')
  const category = fields.get('category')
  const title = fields.get('title')
  const kicker = fields.get('kicker')
  if (!id || !category || !title || !kicker) {
    throw new Error(`article header is missing a required field (id/category/title/kicker):\n${headerText}`)
  }
  return { id, category, title, kicker }
}

function parseChips(trailer: string | undefined): ArticleChip[] {
  if (trailer === undefined) return []
  const chips: ArticleChip[] = []
  for (const line of trailer.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('try:')) {
      chips.push({ kind: 'console', label: 'try in the console →', query: trimmed.slice('try:'.length).trim() })
    } else if (trimmed.startsWith('related:')) {
      const [targetId, label] = trimmed
        .slice('related:'.length)
        .split('|')
        .map((part) => part.trim())
      if (targetId && label) chips.push({ kind: 'related', label: `related: ${label}`, targetId })
    }
  }
  return chips
}

function parseArticle(raw: string): Article {
  const { header, body, trailer } = splitSections(raw)
  return { ...parseHeader(header), body: body.trim(), chips: parseChips(trailer) }
}

// Reihenfolge = Sidebar-Reihenfolge im Design (Prototyp Z. 380-388) und Spec-Aufzählung (docs/001 §2).
const RAW_ARTICLES = [
  gettingStartedRaw,
  domainsIsolationRaw,
  kvEngineRaw,
  jsonDocumentsIndexesRaw,
  lurasqlRaw,
  crossEngineLinksRaw,
  authPermissionsRaw,
  backupRestoreRaw,
  errorsStatusCodesRaw,
]

export const ARTICLES: Article[] = RAW_ARTICLES.map(parseArticle)

export function getArticle(id: string): Article | undefined {
  return ARTICLES.find((article) => article.id === id)
}

export interface SearchHit {
  article: Article
  context: string
}

const CONTEXT_RADIUS = 40

function contextAround(haystack: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - CONTEXT_RADIUS)
  const end = Math.min(haystack.length, index + matchLength + CONTEXT_RADIUS)
  const snippet = haystack.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${snippet}${end < haystack.length ? '…' : ''}`
}

/** Clientseitige Volltextsuche über Titel + Rohtext (spec docs/001 §5); Treffer inkl. Kontextzeile. */
export function searchArticles(query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const hits: SearchHit[] = []
  for (const article of ARTICLES) {
    const haystack = `${article.title}\n${article.body}`
    const index = haystack.toLowerCase().indexOf(needle)
    if (index === -1) continue
    hits.push({ article, context: contextAround(haystack, index, needle.length) })
  }
  return hits
}
