import { parse, TomlError } from 'smol-toml'
import { patchToml, splitTomlPath, type TomlEdit } from '../../lib/tomlPatch'

// Modell + Diff-Logik des Config-Screens (spec config/001 §2–§5): rein textbasiert; smol-toml nur zum Parsen/Anzeigen.

export type ConfigValueKind = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'other'
export type EditableValue = string | number | boolean

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
  editable: boolean
  enumOptions?: string[]
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

export interface PendingChange {
  old: EditableValue
  new: EditableValue
}

export type PendingDiff = ReadonlyMap<string, PendingChange>

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

const KNOWN_ENUMS: Record<string, string[]> = { 'log.level': ['info', 'verbose', 'prod'] }
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

/** Anzeigeform eines Wertes; maskierte Werte erscheinen nie unmaskiert. */
export function formatValue(value: unknown, masked: boolean): string {
  return masked ? MASKED_DISPLAY : formatScalar(value)
}

function isMasked(key: string, value: unknown): boolean {
  return MASK_KEY.test(key) || (typeof value === 'string' && value.includes('changeme'))
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
    pushRow(rows, byPath, {
      path,
      section,
      key,
      label,
      kind: 'array',
      value,
      display: formatArray(value),
      masked: isMasked(key, value),
      editable: false,
    })
    return
  }

  const insideArray = path.includes('[')
  const enumOptions = KNOWN_ENUMS[path]
  let kind: ConfigValueKind
  if (enumOptions !== undefined && typeof value === 'string') kind = 'enum'
  else if (typeof value === 'boolean') kind = 'boolean'
  else if (typeof value === 'number') kind = 'number'
  else if (typeof value === 'string') kind = 'string'
  else kind = 'other'

  const masked = isMasked(key, value)
  const editable = !insideArray && kind !== 'other'
  pushRow(rows, byPath, {
    path,
    section,
    key,
    label,
    kind,
    value,
    display: masked ? MASKED_DISPLAY : formatScalar(value),
    masked,
    editable,
    enumOptions,
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

/** Setzt/aktualisiert/entfernt einen Diff-Eintrag; Rücksetzen auf den Originalwert (typbewusst) entfernt ihn. */
export function applyRowEdit(
  diff: PendingDiff,
  path: string,
  oldValue: EditableValue,
  newValue: EditableValue,
): Map<string, PendingChange> {
  const next = new Map(diff)
  if (newValue === oldValue) next.delete(path)
  else next.set(path, { old: oldValue, new: newValue })
  return next
}

function pendingToEdits(diff: PendingDiff): TomlEdit[] {
  const edits: TomlEdit[] = []
  for (const [path, change] of diff) {
    const { section, key } = splitTomlPath(path)
    edits.push({ section, key, value: change.new })
  }
  return edits
}

/** Der herunterzuladende Text: Original mit allen Pending-Änderungen gepatcht. */
export function applyPending(originalText: string, diff: PendingDiff): string {
  return patchToml(originalText, pendingToEdits(diff))
}
