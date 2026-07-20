// Kommentar-erhaltender, textbasierter TOML-Patcher (spec config/001 §5): ersetzt `key = value`
// zeilenweise im Sektionsblock, ohne das Dokument über smol-toml zu reserialisieren (das zerstört Kommentare).

export type TomlScalar = string | number | boolean | bigint

export interface TomlEdit {
  /** Sektionsblock, dotted für Untertabellen (`log.modules`), '' für Wurzel-Keys. */
  section: string
  key: string
  value: TomlScalar
}

const TABLE_HEADER = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/
const ARRAY_HEADER = /^\s*\[\[([^[\]]+)\]\]\s*(?:#.*)?$/

function singleTableName(line: string): string | null {
  const match = TABLE_HEADER.exec(line)
  return match ? (match[1] ?? '').trim() : null
}

function isAnyHeader(line: string): boolean {
  return ARRAY_HEADER.test(line) || TABLE_HEADER.test(line)
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export function serializeTomlValue(value: TomlScalar): string {
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
    case 'bigint':
      return String(value)
    default:
      return `"${escapeTomlString(value)}"`
  }
}

/** Zerlegt einen Wertpfad an seinem letzten Punkt in (Sektion, Key) für den Patcher. */
export function splitTomlPath(path: string): { section: string; key: string } {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return { section: '', key: path }
  return { section: path.slice(0, dot), key: path.slice(dot + 1) }
}

// Erhält den Inline-Kommentar (samt führendem Whitespace) hinter einem Wert; quote-bewusst, damit `#` in Strings nicht greift.
function trailingComment(rest: string): string {
  let quote: string | null = null
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        i++
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') {
      let start = i
      while (start > 0 && (rest[start - 1] === ' ' || rest[start - 1] === '\t')) start--
      return rest.slice(start)
    }
  }
  return ''
}

// Content-Bereich (ohne Header-Zeile) des ersten passenden Sektionsblocks; null wenn die Sektion fehlt.
function findBlockRange(lines: string[], section: string): { start: number; end: number } | null {
  if (section === '') {
    let end = lines.length
    for (let i = 0; i < lines.length; i++) {
      if (isAnyHeader(lines[i] ?? '')) {
        end = i
        break
      }
    }
    return { start: 0, end }
  }
  let header = -1
  for (let i = 0; i < lines.length; i++) {
    if (singleTableName(lines[i] ?? '') === section) {
      header = i
      break
    }
  }
  if (header === -1) return null
  let end = lines.length
  for (let i = header + 1; i < lines.length; i++) {
    if (isAnyHeader(lines[i] ?? '')) {
      end = i
      break
    }
  }
  return { start: header + 1, end }
}

function keyLineRegex(key: string): RegExp {
  const escaped = escapeRegExp(key)
  return new RegExp(`^(\\s*)(#\\s*)?(${escaped}|"${escaped}"|'${escaped}')(\\s*=\\s*)(.*)$`)
}

function applyEdit(lines: string[], edit: TomlEdit): string[] {
  const serialized = serializeTomlValue(edit.value)
  const range = findBlockRange(lines, edit.section)
  if (range === null) {
    const header = edit.section === '' ? [] : ['', `[${edit.section}]`]
    return [...lines, ...header, `${edit.key} = ${serialized}`]
  }

  const regex = keyLineRegex(edit.key)
  for (let i = range.start; i < range.end; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const match = regex.exec(line)
    if (match === null) continue
    const indent = match[1] ?? ''
    const keyToken = match[3] ?? edit.key
    const equals = match[4] ?? ' = '
    const comment = trailingComment(match[5] ?? '')
    const next = [...lines]
    next[i] = `${indent}${keyToken}${equals}${serialized}${comment}`
    return next
  }

  let insertAt = range.end
  while (insertAt > range.start && isBlank(lines[insertAt - 1] ?? '')) insertAt--
  const next = [...lines]
  next.splice(insertAt, 0, `${edit.key} = ${serialized}`)
  return next
}

/** Wendet alle Edits nacheinander auf den Originaltext an und erhält Zeilenenden/Kommentare. */
export function patchToml(original: string, edits: TomlEdit[]): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  let lines = original.split(/\r?\n/)
  for (const edit of edits) lines = applyEdit(lines, edit)
  return lines.join(eol)
}
