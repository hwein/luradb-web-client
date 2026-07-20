import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, execSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readChangelog, extractSection, latestVersion } from './changelog-extract.mjs'

// Release-Automatik (Adaption des LuraDB-Verfahrens). Erst alle Checks, dann
// Mutationen. Ablauf auf `next`: Changelog finalisieren → Version bumpen →
// next→main mergen → taggen → pushen. --dry-run zeigt den Plan ohne Änderungen.
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHANGELOG = path.join(rootDir, 'CHANGELOG.md')
const PKG = path.join(rootDir, 'package.json')

const dryRun = process.argv.includes('--dry-run')
const versionArg = process.argv.slice(2).find((a) => /^\d+\.\d+\.\d+$/.test(a))

const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf-8' }).trim()
const sh = (cmd) => execSync(cmd, { cwd: rootDir, stdio: 'inherit' })
const die = (msg) => { console.error(`release: ${msg}`); process.exit(1) }
const step = (msg) => console.log(`-- ${msg}`)

function versionGt(a, b) {
  const A = a.split('.').map(Number)
  const B = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (A[i] > B[i]) return true
    if (A[i] < B[i]) return false
  }
  return false
}

function bumpPatch(base) {
  const [maj, min, pat] = base.split('.').map(Number)
  return `${maj}.${min}.${pat + 1}`
}

function resolveRepoUrl() {
  let url = git('remote', 'get-url', 'origin').replace(/\.git$/, '')
  const m = /^git@github\.com:(.+)$/.exec(url)
  return m ? `https://github.com/${m[1]}` : url
}

// Entfernt Kategorieblöcke ("### Name" ohne Bullet-Inhalt) aus dem Body.
function filterEmptyCategories(bodyText) {
  const out = []
  let block = null
  let hasContent = false
  const flush = () => { if (block && hasContent) out.push(...block) }
  for (const line of bodyText.split('\n')) {
    if (/^### /.test(line)) { flush(); block = [line]; hasContent = false }
    else if (block) { block.push(line); if (!/^\s*$/.test(line)) hasContent = true }
    else out.push(line)
  }
  flush()
  while (out.length && /^\s*$/.test(out[out.length - 1])) out.pop()
  return out.join('\n')
}

// Baut CHANGELOG.md neu: [Unreleased] → [version] - heute, frisches leeres
// [Unreleased], Referenzblock aus allen Versionen neu erzeugt.
function rebuildChangelog(version) {
  const date = new Date().toISOString().slice(0, 10)
  const text = readChangelog()
  const lines = text.split(/\r?\n/)
  const uIdx = lines.findIndex((l) => /^## \[Unreleased\]/.test(l))
  if (uIdx < 0) die('no [Unreleased] heading in CHANGELOG.md')

  let pre = lines.slice(0, uIdx)
  while (pre.length && /^\s*$/.test(pre[pre.length - 1])) pre.pop()

  let restStart = -1
  for (let i = uIdx + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) { restStart = i; break }
  }
  let rest = restStart >= 0 ? lines.slice(restStart) : []
  let end = rest.length - 1
  while (end >= 0 && /^\s*$/.test(rest[end])) end--
  while (end >= 0 && /^\[[^\]]+\]:/.test(rest[end])) end--
  while (end >= 0 && /^\s*$/.test(rest[end])) end--
  const restNoRefs = rest.slice(0, end + 1)

  const body = filterEmptyCategories(extractSection(text, 'Unreleased'))
  const existing = restNoRefs
    .map((l) => /^## \[(\d+\.\d+\.\d+)\]/.exec(l))
    .filter(Boolean)
    .map((m) => m[1])

  const repoUrl = resolveRepoUrl()
  const refs = [`[unreleased]: ${repoUrl}/compare/v${version}...HEAD`]
  let prev = version
  for (const v of existing) {
    refs.push(`[${prev}]: ${repoUrl}/compare/v${v}...v${prev}`)
    prev = v
  }
  refs.push(`[${prev}]: ${repoUrl}/releases/tag/v${prev}`)

  const out = [...pre, '', '## [Unreleased]', '', `## [${version}] - ${date}`, '', body, '']
  if (restNoRefs.length) out.push(...restNoRefs, '')
  out.push(...refs, '')
  writeFileSync(CHANGELOG, out.join('\n'))
}

function setVersion(version) {
  const pkg = JSON.parse(readFileSync(PKG, 'utf-8'))
  pkg.version = version
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`)
  sh('node scripts/sync-version.mjs')
}

async function confirmVersion(proposed, last) {
  if (versionArg) return versionArg
  if (dryRun) { console.log(`Version proposal: ${proposed} (dry-run)`); return proposed }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((res) =>
    rl.question(`Version proposal: ${proposed} — Enter to accept, or type X.Y.Z: `, res),
  )
  rl.close()
  const version = answer.trim() || proposed
  if (!/^\d+\.\d+\.\d+$/.test(version)) die(`invalid version: ${version} (expected X.Y.Z)`)
  if (last && !versionGt(version, last)) die(`version ${version} is not greater than the last release ${last}`)
  return version
}

// --- Preflight ---
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'next') die('must be on branch `next`')
if (git('status', '--porcelain')) die('working tree not clean — commit or stash first')

step('npm run check')
sh('npm run check')
step('npm test')
sh('npm test')

const changelog = readChangelog()
const unreleased = extractSection(changelog, 'Unreleased')
if (!unreleased) die('[Unreleased] is missing or empty — nothing to release')

// --- Version proposal: always a patch bump. The client produces no breaking
// changes (it consumes the LuraDB API); minor/major are the author's manual
// call at the confirm prompt below. ---
const last = latestVersion(changelog)
let proposed
if (last) {
  proposed = bumpPatch(last)
} else {
  proposed = JSON.parse(readFileSync(PKG, 'utf-8')).version.replace(/-.*$/, '')
}

const version = await confirmVersion(proposed, last)
const tag = `v${version}`
if (git('tag', '-l', tag)) die(`tag ${tag} already exists`)

if (dryRun) {
  console.log(`[dry-run] would finalize CHANGELOG → [${version}], bump to ${version}, merge next → main,`)
  console.log(`[dry-run] tag ${tag}, set next to ${bumpPatch(version)}-dev, push --atomic origin main next ${tag}`)
  process.exit(0)
}

// --- Mutations ---
step(`finalize CHANGELOG → [${version}]`)
rebuildChangelog(version)
step(`version → ${version}`)
setVersion(version)
step(`commit release prep on next`)
git('add', 'CHANGELOG.md', 'package.json', 'src-tauri/Cargo.toml')
git('commit', '-m', `chore(release): prepare ${tag}`)

step('main: merge --no-ff next')
git('checkout', 'main')
git('merge', '--no-ff', 'next', '-m', `chore(release): ${tag}`)
step(`tag ${tag}`)
git('tag', '-a', tag, '-m', `LuraDB Web Client ${tag}`)

step('next: merge --ff-only main')
git('checkout', 'next')
git('merge', '--ff-only', 'main')

// Dev-Zyklus: next auf X.Y.(Z+1)-dev, damit Dev-Builds nie eine Release-Nummer melden.
const nextDev = `${bumpPatch(version)}-dev`
step(`next: begin v${nextDev} cycle`)
setVersion(nextDev)
git('add', 'package.json', 'src-tauri/Cargo.toml')
git('commit', '-m', `chore(release): begin v${nextDev} cycle`)

step(`push --atomic origin main next ${tag}`)
git('push', '--atomic', 'origin', 'main', 'next', tag)

console.log(`\nReleased ${tag}. The tag triggers the release workflow: it builds the`)
console.log('Windows installer and drafts the GitHub release with these changelog notes.')
