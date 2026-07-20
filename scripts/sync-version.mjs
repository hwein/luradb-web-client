import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// package.json ist die einzige Versionsquelle. tauri.conf.json referenziert sie
// direkt; nur die [package]-Version in Cargo.toml driftet sonst — dieser Hook
// zieht sie nach. Laeuft automatisch als npm-`version`-Lifecycle bei `npm version`.
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
