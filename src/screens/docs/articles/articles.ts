import gettingStartedRaw from './getting-started.md?raw'

export const DOCS_HOST = 'docs.luradb.org'
export const DOCS_SITE = `https://${DOCS_HOST}`

export interface DocEntry {
  id: string
  category: string
  title: string
}

export interface ArticleMeta extends DocEntry {
  kicker: string
}

export type ArticleChip = { kind: 'related'; label: string; targetId: string }

export interface Article extends ArticleMeta {
  /** Markdown-Rumpf ohne Frontmatter/Chip-Trailer — Eingabe für den Renderer (markdown.ts). */
  body: string
  chips: ArticleChip[]
}

export interface RemoteTopic extends DocEntry {
  /** Path behind DOCS_SITE, without anchor. */
  path: string
  anchor?: string
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
    if (trimmed.startsWith('related:')) {
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

export const ARTICLES: Article[] = [parseArticle(gettingStartedRaw)]

export function getArticle(id: string): Article | undefined {
  return ARTICLES.find((article) => article.id === id)
}

export const REMOTE_TOPICS: RemoteTopic[] = [
  { id: 'domains-isolation', category: 'Domains & isolation', title: 'Domains and engines', path: '/how-it-works/domains-and-engines/' },
  { id: 'kv-engine', category: 'Key-Value engine', title: 'Key-value', path: '/using/key-value/' },
  { id: 'json-documents-indexes', category: 'JSON documents & indexes', title: 'JSON documents', path: '/using/json-documents/' },
  { id: 'lurasql', category: 'LuraSQL (rel engine)', title: 'LuraSQL', path: '/using/lurasql/' },
  {
    id: 'cross-engine-links',
    category: 'Cross-engine links',
    title: 'KVREF & JSONREF columns',
    path: '/using/lurasql/',
    anchor: 'a-reference-can-embed-the-row-it-points-to',
  },
  { id: 'auth-permissions', category: 'Auth & permissions', title: 'Security', path: '/operating/security/' },
  { id: 'mcp', category: 'MCP', title: 'MCP server', path: '/using/mcp-server/' },
  { id: 'backup-restore', category: 'Backup & restore', title: 'Backup and restore', path: '/operating/backup-and-restore/' },
  { id: 'errors-status-codes', category: 'Errors & status codes', title: 'Status codes', path: '/reference/status-codes/' },
]

export function getRemoteTopic(id: string): RemoteTopic | undefined {
  return REMOTE_TOPICS.find((topic) => topic.id === id)
}

// Sidebar order of the design: the bundled article first, then the nine topics served from DOCS_SITE.
export const DOC_ENTRIES: DocEntry[] = [...ARTICLES, ...REMOTE_TOPICS]

export function getDocEntry(id: string): DocEntry | undefined {
  return DOC_ENTRIES.find((entry) => entry.id === id)
}

/** Page of DOCS_SITE for a topic id, or for an id that is itself a site path (starts with `/`). */
export function resolveSitePage(id: string): { path: string; anchor?: string } | undefined {
  const topic = getRemoteTopic(id)
  if (topic) return topic.anchor === undefined ? { path: topic.path } : { path: topic.path, anchor: topic.anchor }
  return id.startsWith('/') ? { path: id } : undefined
}

/** The topic id whose page (without anchor) is `path`, otherwise the path itself. */
export function docsIdForSitePath(path: string): string {
  return REMOTE_TOPICS.find((topic) => topic.anchor === undefined && topic.path === path)?.id ?? path
}

export interface SearchHit {
  entry: DocEntry
  context: string
}

const CONTEXT_RADIUS = 40

function contextAround(haystack: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - CONTEXT_RADIUS)
  const end = Math.min(haystack.length, index + matchLength + CONTEXT_RADIUS)
  const snippet = haystack.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${snippet}${end < haystack.length ? '…' : ''}`
}

/** Full text of the bundled article; remote topics match by title or category only, with the site as context. */
export function searchArticles(query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const hits: SearchHit[] = []
  for (const entry of DOC_ENTRIES) {
    const article = getArticle(entry.id)
    if (article) {
      const haystack = `${article.title}\n${article.body}`
      const index = haystack.toLowerCase().indexOf(needle)
      if (index !== -1) hits.push({ entry, context: contextAround(haystack, index, needle.length) })
    } else if (entry.title.toLowerCase().includes(needle) || entry.category.toLowerCase().includes(needle)) {
      hits.push({ entry, context: DOCS_HOST })
    }
  }
  return hits
}
