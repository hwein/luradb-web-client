// Guards the public repo's text: English only, self-contained, no marker lines.
// Usage: node scripts/check-public-text.mjs [file ...] | --message "<text>" | --commits
// Prints one `<file>:<line>: <rule>` per finding; exit 1 on findings, 2 on an unknown option, an unreadable file or a missing commit baseline.
// Non-ASCII characters and the first letter of each word-list entry are escaped so this file never matches itself.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Tip of the development branch when the language policy was introduced; only later commits are checked.
const BASELINE = 'e062544c466979ef3e987dfec4ea79778bc6842c'

// Files that come from outside this repo.
const EXTERNAL = new Set([
  'src/api/openapi.json',
  'src/api/schema.d.ts',
  'src/api/server-changelog.md',
  'package-lock.json',
  'src-tauri/Cargo.lock',
])

const GERMAN_WORDS = [
  '\u0075nd', '\u006fder', '\u006eicht', '\u0077ird', '\u0077erden', '\u0066\u00fcr', '\u0073ind', '\u0077enn',
  '\u0061uch', '\u006eoch', '\u006eur', '\u006bein', '\u006beine', '\u0062ereits', '\u0062leibt', '\u0073iehe',
  '\u007aum', '\u007aur', '\u0064ass', '\u00fcber', '\u0077eil', '\u0073onst', '\u006fhne', '\u0065ine',
  '\u0065inen', '\u0065iner', '\u0069st', '\u0062ei', '\u006each', '\u0073ich', '\u0077ie', '\u0068ier',
  '\u006aetzt', '\u0064ann', '\u0064amit', '\u006duss', '\u0073oll', '\u0064er', '\u0064as', '\u0064en',
  '\u0064em', '\u0064es', '\u0065in', '\u007au', '\u0061uf', '\u0061us', '\u0076om', '\u0062eim',
  '\u0061ls', '\u0073tatt', '\u0077ir', '\u0062is', '\u006eie', '\u0061lle', '\u006aede', '\u006aeder',
  '\u0062zw', '\u0067gf', '\u0073owie', '\u0069m',
]

const GERMAN = [
  /[\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]/u,
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:${GERMAN_WORDS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu'),
]

const REFERENCE = [
  /\b(general|shell|sql|data|rest|engines|admin|config|docs)\/[0-9]{3}\b/,
  /\bs-[0-9a-f]{8}\b/,
  /\b(spec|concept) [0-9]{3}\b/,
  /\u00a7/,
  /\b(\u0050rototyp|\u0070rototype lines?|\u0048andoff|\u0053tyleguide|\u004frchestrator)\b/,
  /\b(\u0043OMPATIBILITY|\u004cURASQL)\.md\b/,
  /\b(\u0041utor|author|team|PO)[- ](\u0056orgabe|\u0045ntscheid|decision|instruction)/,
]

const MARKER = /^\s*(\{?\/\*|\/\/[/!]?|#)\s*(-|=|\u2500|\u2501|\u2550){2,}/

const RULES = [
  ['german', GERMAN, true],
  ['reference', REFERENCE, true],
  ['marker', [MARKER], false],
]

function scan(label, text, { markers }) {
  const hits = []
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [name, patterns, anyText] of RULES) {
      if (!anyText && !markers) continue
      for (const pattern of patterns) {
        const m = pattern.exec(line)
        if (m) {
          hits.push(`${label}:${i + 1}: ${name}`)
          break
        }
      }
    }
  })
  return hits
}

function git(args) {
  return spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
}

function trackedFiles() {
  const r = git(['ls-files', '-z'])
  if (r.status !== 0) {
    console.error(`git ls-files failed: ${r.stderr.trim()}`)
    process.exit(2)
  }
  return r.stdout.split('\0').filter((f) => f && !EXTERNAL.has(f))
}

function scanFiles(files, { strict }) {
  const hits = []
  for (const file of files) {
    let buf
    try {
      buf = readFileSync(file)
    } catch (error) {
      if (!strict) continue
      console.error(`cannot read ${file}: ${error.code ?? error.message}`)
      process.exit(2)
    }
    if (buf.subarray(0, 8000).includes(0)) continue
    hits.push(...scan(file, buf.toString('utf8'), { markers: true }))
  }
  return hits
}

function scanCommits() {
  if (git(['cat-file', '-e', `${BASELINE}^{commit}`]).status !== 0) {
    console.error(`commit baseline ${BASELINE} is not reachable (shallow clone?); fetch full history`)
    process.exit(2)
  }
  const r = git(['rev-list', `${BASELINE}..HEAD`])
  if (r.status !== 0) {
    console.error(`git rev-list failed: ${r.stderr.trim()}`)
    process.exit(2)
  }
  const hits = []
  for (const sha of r.stdout.split('\n').filter(Boolean)) {
    const body = git(['log', '-1', '--format=%B', sha]).stdout
    hits.push(...scan(sha.slice(0, 10), body, { markers: false }))
  }
  return hits
}

const args = process.argv.slice(2)
let hits
if (args[0] === '--message') {
  hits = scan('message', args.slice(1).join(' '), { markers: false })
} else if (args[0] === '--commits') {
  hits = scanCommits()
} else {
  const unknown = args.find((arg) => arg.startsWith('--'))
  if (unknown) {
    console.error(`unknown option ${unknown}; expected --message "<text>", --commits or file paths`)
    process.exit(2)
  }
  hits = args.length > 0 ? scanFiles(args, { strict: true }) : scanFiles(trackedFiles(), { strict: false })
}
for (const hit of hits) console.log(hit)
process.exit(hits.length > 0 ? 1 : 0)
