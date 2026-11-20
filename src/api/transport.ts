import { fetch as pluginFetch } from '@tauri-apps/plugin-http'

/** Running in the Tauri webview? `__TAURI_INTERNALS__` exists only there, never in a browser. */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export interface EnvTransport {
  fetchImpl: typeof fetch
}

/**
 * Desktop: plugin-http (Rust layer, no CORS, any server URL). Browser: native fetch — same-origin via proxy, or cross-origin when the server allows it (CORS).
 * `acceptInvalidCerts: true` wraps `pluginFetch` with `danger` (disables TLS verification entirely, hostname
 * included, per rustls behavior); otherwise (also in the browser) the option has no effect.
 */
export function getTransport(options?: { acceptInvalidCerts?: boolean }): EnvTransport {
  if (!isTauri()) return { fetchImpl: fetch }
  if (options?.acceptInvalidCerts !== true) return { fetchImpl: pluginFetch }
  const danger = { acceptInvalidCerts: true, acceptInvalidHostnames: true }
  // Fresh init per call: the plugin mutates the passed init object via `delete`.
  return { fetchImpl: (input, init) => pluginFetch(input, { ...init, danger }) }
}
