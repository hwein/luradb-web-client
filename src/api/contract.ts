import openapiDocument from './openapi.json'
import type { components } from './schema'

export const BASE_PATH = '/store-api'

export interface SemVer {
  major: number
  minor: number
  patch: number
}

function parseSemVer(version: string): SemVer {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`invalid semver: "${version}"`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** API-Contract, gegen den dieser Client gebaut wurde — rein informativ (About/Statusbar). */
export const CONTRACT_VERSION: SemVer = parseSemVer(openapiDocument.info.version)

/**
 * Niedrigste unterstützte LuraDB-Server-Version. Bewusst gepflegte Tatsache,
 * NICHT aus dem Contract abgeleitet: nur anheben, wenn der Client anfängt, etwas
 * zu nutzen, das ältere Server nicht können — im selben Commit, mit Begründung.
 * Ausschließlich manuelle Maintainer-Entscheidung.
 */
export const MIN_SERVER_VERSION = '0.2.0'
const minServer = parseSemVer(MIN_SERVER_VERSION)

export interface CompatibilityResult {
  compatible: boolean
  reason?: string
}

type VersionResponse = components['schemas']['VersionResponse']

/** Verlässliches Verfahren: Server wird unterstützt gdw. seine Version >= MIN_SERVER_VERSION. */
export function checkCompatibility(versionResponse: VersionResponse): CompatibilityResult {
  const serverVersion = parseSemVer(versionResponse.server_version)
  if (compareSemVer(serverVersion, minServer) < 0) {
    return {
      compatible: false,
      reason: `LuraDB ${versionResponse.server_version} is older than the minimum supported ${MIN_SERVER_VERSION}`,
    }
  }
  return { compatible: true }
}
