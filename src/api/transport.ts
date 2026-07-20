import { fetch as pluginFetch } from '@tauri-apps/plugin-http'

/** Läuft der Code in der Tauri-WebView? `__TAURI_INTERNALS__` existiert nur dort, nie im Browser. */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export interface EnvTransport {
  fetchImpl: typeof fetch
  defaultBaseUrl: string
}

/** Desktop: Plugin-http (Rust-Schicht, kein CORS, freie Server-URL). Browser: natives fetch, Same-Origin/Proxy. */
export function getTransport(): EnvTransport {
  return isTauri() ? { fetchImpl: pluginFetch, defaultBaseUrl: '' } : { fetchImpl: fetch, defaultBaseUrl: '' }
}
