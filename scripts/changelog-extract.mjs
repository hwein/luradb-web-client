import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Liest Abschnitte aus CHANGELOG.md (Keep a Changelog 1.1.0). Von release.mjs
// und dem Release-Workflow (Release-Notes) genutzt.
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHANGELOG = path.join(rootDir, 'CHANGELOG.md')

export function readChangelog() {
  return readFileSync(CHANGELOG, 'utf-8')
}

/** Getrimmter Body von `## [target]` (ohne Überschrift, ohne Referenz-Linkblock), oder null. */
export function extractSection(text, target) {
  let state = 0
  const body = []
  for (const line of text.split(/\r?\n/)) {
    if (/^## \[/.test(line)) {
      if (state === 1) state = 2
      else if (state === 0) {
        const m = /^## \[([^\]]+)\]/.exec(line)
        if (m && m[1] === target) state = 1
      }
      continue
    }
    if (state === 1) body.push(line)
  }
  if (state === 0) return null
  let first = 0
  let last = body.length - 1
  while (last >= first && /^\s*$/.test(body[last])) last--
  while (last >= first && /^\[[^\]]+\]:/.test(body[last])) last--
  while (first <= last && /^\s*$/.test(body[first])) first++
  while (last >= first && /^\s*$/.test(body[last])) last--
  if (first > last) return null
  return body.slice(first, last + 1).join('\n')
}

/** Oberste veröffentlichte Version (erster Abschnitt außer Unreleased), oder null. */
export function latestVersion(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^## \[([^\]]+)\]/.exec(line)
    if (m && m[1] !== 'Unreleased') return m[1]
  }
  return null
}

const invokedDirectly = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const arg = process.argv[2]
  const text = readChangelog()
  if (arg === '--latest-version') {
    const v = latestVersion(text)
    if (!v) { console.error('changelog-extract: no release section'); process.exit(1) }
    console.log(v)
  } else if (arg) {
    const body = extractSection(text, arg === 'unreleased' ? 'Unreleased' : arg)
    if (!body) { console.error(`changelog-extract: section [${arg}] missing or empty`); process.exit(1) }
    console.log(body)
  } else {
    console.error('Usage: changelog-extract.mjs <version> | unreleased | --latest-version')
    process.exit(1)
  }
}
