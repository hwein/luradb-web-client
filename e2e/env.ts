import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { APIRequestContext } from '@playwright/test'

export interface ServerEnv {
  url: string
  adminKey: string
}

// npm-Scripts laufen im Paket-Root; kein dotenv-Paket, kein VITE_-Präfix (der Key gehört nie ins Bundle).
const ENV_FILE = resolve(process.cwd(), '.env.local')

function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim())
  }
  return values
}

/** Wirft mit klarer Meldung statt still zu überspringen; Fehlertexte nennen nie den Key selbst. */
export function readServerEnv(): ServerEnv {
  let content: string
  try {
    content = readFileSync(ENV_FILE, 'utf-8')
  } catch {
    throw new Error(`e2e needs ${ENV_FILE} with LURADB_URL and LURADB_ADMIN_KEY`)
  }
  const values = parseEnvFile(content)
  const url = values.get('LURADB_URL')
  const adminKey = values.get('LURADB_ADMIN_KEY')
  if (url === undefined || url === '') throw new Error(`LURADB_URL is missing or empty in ${ENV_FILE}`)
  if (adminKey === undefined || adminKey === '') throw new Error(`LURADB_ADMIN_KEY is missing or empty in ${ENV_FILE}`)
  return { url: url.replace(/\/+$/, ''), adminKey }
}

/** Die drei Engine-Registries sind getrennte Namespaces — die UI-Anlage kaskadiert, das Aufräumen muss es auch. */
export async function dropDomain(api: APIRequestContext, domain: string): Promise<void> {
  for (const registry of ['rel/', 'json/', '']) {
    // Best effort: 404/202 sind beide in Ordnung, ein Netzfehler darf den Lauf nicht rot färben.
    await api.delete(`/store-api/${registry}domains/${domain}`).catch(() => undefined)
  }
}
