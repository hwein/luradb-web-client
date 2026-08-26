import { parse, TomlError } from 'smol-toml'

// Modell des Config-Screens (spec config/003): rein lesend — Parsen, Karten-Aufbau, Masking; smol-toml nur zum Parsen.

export type ConfigValueKind = 'string' | 'number' | 'boolean' | 'array' | 'other'

export interface ConfigRow {
  /** Voller Pfad inkl. Array-Indizes, z. B. `server.port`, `auth.admins[0].api_key`, `log.modules.rel`. */
  path: string
  section: string
  key: string
  label: string
  kind: ConfigValueKind
  value: unknown
  display: string
  masked: boolean
}

export interface ConfigCard {
  id: string
  title: string
  lead: string
  rows: ConfigRow[]
}

export interface ConfigParsed {
  ok: true
  cards: ConfigCard[]
  rowsByPath: Map<string, ConfigRow>
}

export interface ConfigParseError {
  ok: false
  message: string
  line?: number
  column?: number
}

export type ConfigModel = ConfigParsed | ConfigParseError

export const MASKED_DISPLAY = '••••••'

// Design-Gruppierung der Karten (Prototyp Z. 287–356); nicht abgedeckte Sektionen bekommen eine eigene Karte.
const CARD_GROUPS: readonly string[][] = [
  ['server'],
  ['auth', 'proxy'],
  ['storage', 'buffer_pool'],
  ['lsm'],
  ['compaction', 'janitor'],
  ['domains', 'rate_limit'],
  ['log'],
]

const MASK_KEY = /(^|_)(api_)?key$|secret|password/i

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function formatArray(value: unknown[]): string {
  return `[${value.map(formatScalar).join(', ')}]`
}

function isMasked(key: string, value: unknown): boolean {
  return MASK_KEY.test(key) || (typeof value === 'string' && value.includes('changeme'))
}

/** Zerlegt einen Wertpfad an seinem letzten Punkt in (Sektion, Key). */
function splitTomlPath(path: string): { section: string; key: string } {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return { section: '', key: path }
  return { section: path.slice(0, dot), key: path.slice(dot + 1) }
}

function pushRow(rows: ConfigRow[], byPath: Map<string, ConfigRow>, row: ConfigRow): void {
  rows.push(row)
  byPath.set(row.path, row)
}

function flatten(path: string, value: unknown, lead: string, rows: ConfigRow[], byPath: Map<string, ConfigRow>): void {
  if (isTable(value)) {
    for (const [key, child] of Object.entries(value)) flatten(`${path}.${key}`, child, lead, rows, byPath)
    return
  }

  const { section, key } = splitTomlPath(path)
  const label = path.startsWith(`${lead}.`) ? path.slice(lead.length + 1) : path

  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isTable)) {
      value.forEach((item, index) => flatten(`${path}[${index}]`, item, lead, rows, byPath))
      return
    }
    const arrayMasked = isMasked(key, value)
    pushRow(rows, byPath, {
      path,
      section,
      key,
      label,
      kind: 'array',
      value,
      display: arrayMasked ? MASKED_DISPLAY : formatArray(value),
      masked: arrayMasked,
    })
    return
  }

  let kind: ConfigValueKind
  if (typeof value === 'boolean') kind = 'boolean'
  else if (typeof value === 'number') kind = 'number'
  else if (typeof value === 'string') kind = 'string'
  else kind = 'other'

  const masked = isMasked(key, value)
  pushRow(rows, byPath, {
    path,
    section,
    key,
    label,
    kind,
    value,
    display: masked ? MASKED_DISPLAY : formatScalar(value),
    masked,
  })
}

/** Parst den Text und baut das Karten-Grid (Datei-Reihenfolge, Design-Gruppierung). Parse-Fehler ⇒ `ok:false`. */
export function buildConfig(text: string): ConfigModel {
  let parsed: Record<string, unknown>
  try {
    parsed = parse(text) as Record<string, unknown>
  } catch (error) {
    if (error instanceof TomlError) return { ok: false, message: error.message, line: error.line, column: error.column }
    return { ok: false, message: error instanceof Error ? error.message : 'invalid toml' }
  }

  const topKeys = Object.keys(parsed)
  const used = new Set<string>()
  const groups: string[][] = []
  for (const group of CARD_GROUPS) {
    const present = group.filter((section) => isTable(parsed[section]))
    if (present.length > 0) {
      groups.push(present)
      for (const section of present) used.add(section)
    }
  }
  for (const section of topKeys) {
    if (!used.has(section) && isTable(parsed[section])) {
      groups.push([section])
      used.add(section)
    }
  }

  const cards: ConfigCard[] = []
  const rowsByPath = new Map<string, ConfigRow>()

  const rootScalars = topKeys.filter((section) => !isTable(parsed[section]))
  if (rootScalars.length > 0) {
    const rows: ConfigRow[] = []
    for (const key of rootScalars) flatten(key, parsed[key], '', rows, rowsByPath)
    cards.push({ id: '(root)', title: '(root)', lead: '', rows })
  }

  for (const group of groups) {
    const lead = group[0] ?? ''
    const rows: ConfigRow[] = []
    for (const section of group) flatten(section, parsed[section], lead, rows, rowsByPath)
    cards.push({ id: lead, title: group.map((section) => `[${section}]`).join(' · '), lead, rows })
  }

  return { ok: true, cards, rowsByPath }
}
