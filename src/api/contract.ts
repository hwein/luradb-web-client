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

export const CONTRACT_VERSION: SemVer = parseSemVer(openapiDocument.info.version)

export interface CompatibilityResult {
  compatible: boolean
  reason?: string
}

type VersionResponse = components['schemas']['VersionResponse']

/** Kompatibilitätsregel siehe api/COMPATIBILITY.md: gleiche Major, Server >= Contract-Version. */
export function checkCompatibility(versionResponse: VersionResponse): CompatibilityResult {
  const apiVersion = parseSemVer(versionResponse.api_version)

  if (apiVersion.major !== CONTRACT_VERSION.major) {
    return {
      compatible: false,
      reason: `server API major ${apiVersion.major} does not match client contract major ${CONTRACT_VERSION.major}`,
    }
  }

  const cmp = compareSemVer(apiVersion, CONTRACT_VERSION)
  if (cmp < 0) {
    return {
      compatible: false,
      reason: `server API ${versionResponse.api_version} is older than client contract ${openapiDocument.info.version}`,
    }
  }
  if (cmp > 0) {
    return {
      compatible: true,
      reason: `server API ${versionResponse.api_version} is newer than client contract ${openapiDocument.info.version}`,
    }
  }
  return { compatible: true }
}
