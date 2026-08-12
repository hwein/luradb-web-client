import { fetch as pluginFetch } from '@tauri-apps/plugin-http'

/** Läuft der Code in der Tauri-WebView? `__TAURI_INTERNALS__` existiert nur dort, nie im Browser. */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export interface EnvTransport {
  fetchImpl: typeof fetch
  defaultBaseUrl: string
}

/**
 * Desktop: Plugin-http (Rust-Schicht, kein CORS, freie Server-URL). Browser: natives fetch, Same-Origin/Proxy.
 * `acceptInvalidCerts: true` wrapt `pluginFetch` mit `danger` (deaktiviert TLS-Prüfung inkl. Hostname komplett,
 * siehe rustls-Verhalten in spec 009); sonst (auch im Browser) bleibt die Option wirkungslos.
 */
export function getTransport(options?: { acceptInvalidCerts?: boolean }): EnvTransport {
  if (!isTauri()) return { fetchImpl: fetch, defaultBaseUrl: '' }
  if (options?.acceptInvalidCerts !== true) return { fetchImpl: pluginFetch, defaultBaseUrl: '' }
  const danger = { acceptInvalidCerts: true, acceptInvalidHostnames: true }
  // Frisches init pro Aufruf: das Plugin mutiert das übergebene init-Objekt per `delete`.
  return { fetchImpl: (input, init) => pluginFetch(input, { ...init, danger }), defaultBaseUrl: '' }
}
