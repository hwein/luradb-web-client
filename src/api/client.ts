import createClient, { type Client, type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import { apiErrorFromResponse, networkApiError } from './errors'

// openapi-fetch's FetchOptions extends RequestInit, so this augmentation types `silentRecord` everywhere,
// from `api.GET(path, { silentRecord: true })` to the init parameters of fetchRaw.
declare global {
  interface RequestInit {
    /** Per-call opt-out: suppresses the onCall recorder entry. Default: recorded. */
    silentRecord?: boolean
  }
}

export interface CallInfo {
  method: string
  path: string
  /** Numeric HTTP status, or 'stream' for an open SSE stream. */
  status: number | 'stream'
  ms: number
  ok: boolean
}

export type OnCallListener = (info: CallInfo) => void

export interface CreateApiOptions {
  /** Full header value (e.g. "Bearer <key>"), or undefined for unauthenticated calls. */
  getAuthHeader: () => string | undefined
  baseUrl: string
  fetchImpl: typeof fetch
}

export interface ApiClient {
  /** Typed openapi-fetch client, e.g. `api.GET('/store-api/domains')`. */
  api: Client<paths>
  onCall: (listener: OnCallListener) => () => void
  /** For non-JSON endpoints (e.g. KV values); throws ApiError on non-2xx. Path includes BASE_PATH. `init.silentRecord` suppresses the recorder entry. */
  fetchRaw: (path: string, init?: RequestInit) => Promise<Response>
  /** GET with Accept: application/x-ndjson, e.g. `/store-api/json/{domain}/export`. */
  fetchNdjson: (path: string, options?: { silentRecord?: boolean }) => Promise<Response>
  /**
   * POST with `Content-Type: text/plain`, the counterpart of `fetchNdjson` (bulk import). Always returns the
   * response, even on non-2xx (like `openStream`): the bulk endpoint reports partial success in the 200 body,
   * 404/503 arrive as plain-text bodies (checked live); the caller decides how to interpret them.
   */
  postNdjson: (path: string, body: string, options?: { silentRecord?: boolean }) => Promise<Response>
  /**
   * Opens an SSE stream (`Accept: text/event-stream`) and returns the response with its body stream
   * intact, even on non-2xx (the caller decides on 401/410). The recorder sees the stream start as a
   * call with status 'stream'. Cancelling goes through the body reader, not a fetch signal.
   * `lastEventId` appends `last_event_id=` (SSE resume); the recorder still shows only the path without query.
   */
  openStream: (path: string, options?: { silentRecord?: boolean; lastEventId?: string }) => Promise<Response>
  /**
   * Like `fetchRaw`, but without `notify()`: the only way around `apiClient.onCall(record)`
   * (every other path, typed or raw, reports to the recorder). For fan-out runs that would
   * otherwise flood RECENT REQUESTS; never throws on non-2xx, only on network errors.
   */
  fetchSilent: (path: string, init?: RequestInit) => Promise<Response>
  /** Like `fetchSilent`, but without the Authorization header, for probes that only work anonymously. Never recorded. */
  fetchAnonymous: (path: string, init?: RequestInit) => Promise<Response>
}

function pathnameOf(url: string): string {
  return new URL(url).pathname
}

/** SSE resume as a query parameter (not the `Last-Event-ID` header: it is not CORS-safelisted). */
function withLastEventId(path: string, lastEventId: string | undefined): string {
  if (lastEventId === undefined || lastEventId === '') return path
  return `${path}${path.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastEventId)}`
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

  // openapi-fetch copies unknown init fields onto the Request object (the same object in all three hooks),
  // so `silentRecord` ends up as a custom property on `request`, not a RequestInit field of the Fetch API.
  function isSilentRequest(request: Request): boolean {
    return (request as Request & { silentRecord?: boolean }).silentRecord === true
  }

  const authMiddleware: Middleware = {
    onRequest({ request, id }) {
      startedAt.set(id, performance.now())
      const authHeader = getAuthHeader()
      if (authHeader !== undefined) request.headers.set('Authorization', authHeader)
    },
    onResponse({ request, response, id }) {
      const ms = elapsedSince(id)
      if (isSilentRequest(request)) return
      notify({
        method: request.method,
        path: pathnameOf(request.url),
        status: response.status,
        ms,
        ok: response.ok,
      })
    },
    onError({ request, id, error }) {
      const ms = elapsedSince(id)
      if (!isSilentRequest(request)) {
        notify({
          method: request.method,
          path: pathnameOf(request.url),
          status: 0,
          ms,
          ok: false,
        })
      }
      return networkApiError(error)
    },
  }

  const api = createClient<paths>({ baseUrl, fetch: fetchImpl })
  api.use(authMiddleware)

  async function rawCall(path: string, init: RequestInit): Promise<Response> {
    const silent = init.silentRecord === true
    const request = new Request(`${baseUrl}${path}`, init)
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)

    const start = performance.now()
    let response: Response
    try {
      response = await fetchImpl(request)
    } catch (error) {
      if (!silent) notify({ method: request.method, path: pathnameOf(request.url), status: 0, ms: performance.now() - start, ok: false })
      throw networkApiError(error)
    }

    if (!silent) {
      notify({
        method: request.method,
        path: pathnameOf(request.url),
        status: response.status,
        ms: performance.now() - start,
        ok: response.ok,
      })
    }
    if (!response.ok) throw await apiErrorFromResponse(response)
    return response
  }

  function fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    return rawCall(path, init ?? {})
  }

  async function fetchSilent(path: string, init?: RequestInit): Promise<Response> {
    const request = new Request(`${baseUrl}${path}`, init)
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)
    try {
      return await fetchImpl(request)
    } catch (error) {
      throw networkApiError(error)
    }
  }

  async function fetchAnonymous(path: string, init?: RequestInit): Promise<Response> {
    const request = new Request(`${baseUrl}${path}`, init)
    try {
      return await fetchImpl(request)
    } catch (error) {
      throw networkApiError(error)
    }
  }

  function fetchNdjson(path: string, options?: { silentRecord?: boolean }): Promise<Response> {
    return rawCall(path, { headers: { Accept: 'application/x-ndjson' }, silentRecord: options?.silentRecord })
  }

  async function postNdjson(path: string, body: string, options?: { silentRecord?: boolean }): Promise<Response> {
    const silent = options?.silentRecord === true
    const request = new Request(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)

    const start = performance.now()
    let response: Response
    try {
      response = await fetchImpl(request)
    } catch (error) {
      if (!silent) notify({ method: request.method, path: pathnameOf(request.url), status: 0, ms: performance.now() - start, ok: false })
      throw networkApiError(error)
    }

    if (!silent) {
      notify({
        method: request.method,
        path: pathnameOf(request.url),
        status: response.status,
        ms: performance.now() - start,
        ok: response.ok,
      })
    }
    return response
  }

  async function openStream(path: string, options?: { silentRecord?: boolean; lastEventId?: string }): Promise<Response> {
    const silent = options?.silentRecord === true
    const request = new Request(`${baseUrl}${withLastEventId(path, options?.lastEventId)}`)
    request.headers.set('Accept', 'text/event-stream')
    const authHeader = getAuthHeader()
    if (authHeader !== undefined) request.headers.set('Authorization', authHeader)

    const start = performance.now()
    let response: Response
    try {
      response = await fetchImpl(request)
    } catch (error) {
      if (!silent) notify({ method: request.method, path: pathnameOf(request.url), status: 0, ms: performance.now() - start, ok: false })
      throw networkApiError(error)
    }

    if (!silent) {
      notify({
        method: request.method,
        path: pathnameOf(request.url),
        status: response.ok ? 'stream' : response.status,
        ms: performance.now() - start,
        ok: response.ok,
      })
    }
    return response
  }

  return { api, onCall, fetchRaw, fetchNdjson, postNdjson, openStream, fetchSilent, fetchAnonymous }
}
