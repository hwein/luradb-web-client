import openapiDocument from './openapi.json'
import type { components } from './schema'

export const BASE_PATH = '/store-api'

export interface SemVer {
  major: number
  minor: number
  patch: number
}

export function parseSemVer(version: string): SemVer {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`invalid semver: "${version}"`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** API contract this client was built against; informational only (About/Statusbar). */
export const CONTRACT_VERSION: SemVer = parseSemVer(openapiDocument.info.version)

/**
 * Lowest supported LuraDB server version. A deliberately maintained fact,
 * NOT derived from the contract: raise it only when the client starts using
 * something older servers cannot do, in the same commit, with a reason.
 * Strictly a manual maintainer decision.
 */
export const MIN_SERVER_VERSION = '0.7.1'
const minServer = parseSemVer(MIN_SERVER_VERSION)

export interface CompatibilityResult {
  compatible: boolean
  reason?: string
}

type VersionResponse = components['schemas']['VersionResponse']

/** The server is supported if and only if its version is >= MIN_SERVER_VERSION. */
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
