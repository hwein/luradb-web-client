import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const contractPath = path.join(rootDir, 'src', 'api', 'openapi.json')
const targetPath = path.join(rootDir, 'src', 'api', 'server-changelog.md')

// Release tag: argument, env, or the server version of the pinned contract.
// Override: npm run api:changelog -- <tag>
let tag = process.argv[2] ?? process.env.LURADB_RELEASE_TAG
if (!tag) {
  const pinned = JSON.parse(readFileSync(contractPath, 'utf8')).info?.['x-luradb-server-version']
  if (typeof pinned !== 'string' || pinned === '') {
    console.error('api:changelog: src/api/openapi.json has no info["x-luradb-server-version"]. Pass a release tag: npm run api:changelog -- <tag>')
    process.exit(1)
  }
  tag = `v${pinned}`
}
const url = `https://raw.githubusercontent.com/hwein/luradb/${tag}/CHANGELOG.md`

const response = await fetch(url)
const source = await response.text()
const heading = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/m.exec(source)

// exitCode instead of process.exit(): exiting right after fetch aborts node on Windows.
if (!response.ok) {
  console.error(`api:changelog: fetch ${url} → HTTP ${response.status}. Is '${tag}' a tag of the LuraDB repository?`)
  process.exitCode = 1
} else if (!heading) {
  console.error(`api:changelog: ${url} holds no release heading`)
  process.exitCode = 1
} else {
  writeFileSync(targetPath, source)
  console.log(`api:changelog: LuraDB changelog @ ${tag}, newest release ${heading[1]} (${heading[2]}) → src/api/server-changelog.md`)
}
