import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// package.json is the single version source. tauri.conf.json references it
// directly; only the [package] version in Cargo.toml would drift, so this hook
// syncs it. Runs automatically as the npm `version` lifecycle on `npm version`.
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf-8')).version
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml')

const cargo = readFileSync(cargoPath, 'utf-8')
const next = cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]*(")/, `$1${version}$2`)

if (next === cargo) {
  console.log(`sync-version: Cargo.toml already at ${version}`)
} else {
  writeFileSync(cargoPath, next)
  console.log(`sync-version: Cargo.toml [package] version → ${version}`)
}
