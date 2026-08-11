import createClient, { type Client, type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import { apiErrorFromResponse, networkApiError } from './errors'

export interface CallInfo {
  method: string
  path: string
  /** Numerischer HTTP-Status, oder 'stream' für einen offenen SSE-Stream (general/006). */
  status: number | 'stream'
  ms: number
  ok: boolean
}

export type OnCallListener = (info: CallInfo) => void

export interface CreateApiOptions {
  /** Vollständiger Header-Wert (z. B. "Bearer <key>") oder undefined für unauthentifizierte Calls. */
  getAuthHeader: () => string | undefined
  baseUrl: string
  fetchImpl: typeof fetch
}

export interface ApiClient {
  /** Typisierter openapi-fetch-Client, z. B. `api.GET('/store-api/domains')`. */
  api: Client<paths>
  onCall: (listener: OnCallListener) => () => void
  /** Für Nicht-JSON-Endpunkte (z. B. KV-Values); wirft ApiError bei Nicht-2xx. Pfad inkl. BASE_PATH. */
  fetchRaw: (path: string, init?: RequestInit) => Promise<Response>
  /** GET mit Accept: application/x-ndjson, z. B. `/store-api/json/{domain}/export`. */
  fetchNdjson: (path: string) => Promise<Response>
  /**
   * POST mit `Content-Type: text/plain` — Gegenrichtung zu `fetchNdjson` (Bulk-Import). Liefert die Response
   * immer zurück, auch bei Nicht-2xx (wie `openStream`): der Bulk-Endpunkt trägt Teilerfolge im 200-Body,
   * 404/503 kommen als Klartext-Body (live geprüft) — der Aufrufer entscheidet über die Interpretation.
   */
  postNdjson: (path: string, body: string) => Promise<Response>
  /**
   * Öffnet einen SSE-Stream (`Accept: text/event-stream`) und liefert die Response mit intaktem
   * Body-Stream zurück — auch bei Nicht-2xx (der Aufrufer entscheidet über 401/410). Der Recorder
   * sieht den Stream-Start als Call mit Status 'stream' (general/006). Abbruch läuft über das
   * Canceln des Body-Readers, nicht über ein fetch-Signal.
   */
  openStream: (path: string) => Promise<Response>
}

function pathnameOf(url: string): string {
  return new URL(url).pathname
}

export function createApi({ getAuthHeader, baseUrl, fetchImpl }: CreateApiOptions): ApiClient {
  const listeners = new Set<OnCallListener>()
  const startedAt = new Map<string, number>()

  function onCall(listener: OnCallListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function notify(info: CallInfo): void {
    for (const listener of listeners) listener(info)
  }

  function elapsedSince(id: string): number {
    const start = startedAt.get(id)
    startedAt.delete(id)
    return start === undefined ? 0 : performance.now() - start
  }

  const authMiddleware: Middleware = {
    onRequest({ request, id }) {
      startedAt.set(id, performance.now())
      const authHeader = getAuthHeader()
      if (authHeader !== undefined) request.headers.set('Authorization', authHeader)
    },
    onResponse({ request, response, id }) {
      notify({
        method: request.method,
        path: pathnameOf(request.url),
        status: response.status,
        ms: elapsedSince(id),
        ok: response.ok,
      })
    },
    onError({ request, id, error }) {
      notify({
        method: request.method,
        path: pathnameOf(request.url),
        status: 0,
        ms: elapsedSince(id),
        ok: false,
      })
      return networkApiError(error)
    },
  }

  const api = createClient<paths>({ baseUrl, fetch: fetchImpl })
  api.use(authMiddleware)

  async function rawCall(path: string, init: RequestInit): Promise<Response> {
    const request = new Request(`${baseUrl}${path}`, init)
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)

    const start = performance.now()
    let response: Response
    try {
      response = await fetchImpl(request)
    } catch (error) {
      notify({ method: request.method, path: pathnameOf(request.url), status: 0, ms: performance.now() - start, ok: false })
      throw networkApiError(error)
    }

    notify({
      method: request.method,
      path: pathnameOf(request.url),
      status: response.status,
      ms: performance.now() - start,
      ok: response.ok,
    })
    if (!response.ok) throw await apiErrorFromResponse(response)
    return response
  }

  function fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    return rawCall(path, init ?? {})
  }

  function fetchNdjson(path: string): Promise<Response> {
    return rawCall(path, { headers: { Accept: 'application/x-ndjson' } })
  }

  async function postNdjson(path: string, body: string): Promise<Response> {
    const request = new Request(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)

    const start = performance.now()
    let response: Response
    try {
      response = await fetchImpl(request)
    } catch (error) {
      notify({ method: request.method, path: pathnameOf(request.url), status: 0, ms: performance.now() - start, ok: false })
      throw networkApiError(error)
    }

    notify({
      method: request.method,
      path: pathnameOf(request.url),
      status: response.status,
      ms: performance.now() - start,
      ok: response.ok,
    })
    return response
  }

  async function openStream(path: string): Promise<Response> {
    const request = new Request(`${baseUrl}${path}`)
    request.headers.set('Accept', 'text/event-stream')
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)

    const start = performance.now()
    let response: Response
    try {
      response = await fetchImpl(request)
    } catch (error) {
      notify({ method: request.method, path: pathnameOf(request.url), status: 0, ms: performance.now() - start, ok: false })
      throw networkApiError(error)
    }

    notify({
      method: request.method,
      path: pathnameOf(request.url),
      status: response.ok ? 'stream' : response.status,
      ms: performance.now() - start,
      ok: response.ok,
    })
    return response
  }

  return { api, onCall, fetchRaw, fetchNdjson, postNdjson, openStream }
}
