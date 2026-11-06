export class ApiError extends Error {
  readonly status: number
  readonly body?: unknown
  readonly retryAfterSecs?: number

  constructor(status: number, message: string, body?: unknown, retryAfterSecs?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.retryAfterSecs = retryAfterSecs
  }
}

/** Zieht die Message aus einem Fehler-Body-Objekt (`{error}`/`{message}`) — auch für openapi-fetch-`error`-Werte. */
export function messageFromBody(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.message === 'string') return record.message
  }
  return undefined
}

// LuraDB-Plaintext ist einzeilig kurz; der Deckel hält Fremd-Bodies (Proxy-HTML-Fehlerseiten) aus den Inline-Meldungen.
const MAX_PLAINTEXT_MESSAGE = 300

/** Baut einen ApiError aus einer Nicht-2xx-Response; konsumiert den Body. LuraDB antwortet auf Fehler mit Plaintext `NNN Reason: Detail`. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  const trimmed = text.trim()
  let body: unknown
  let isJson = false
  try {
    body = JSON.parse(trimmed)
    isJson = true
  } catch {
    body = undefined
  }
  const statusText = response.statusText.length > 0 ? response.statusText : `HTTP ${response.status}`
  const firstLine = (trimmed.split('\n', 1)[0] ?? '').slice(0, MAX_PLAINTEXT_MESSAGE)
  const plaintext = isJson || firstLine === '' ? undefined : firstLine
  const message = messageFromBody(body) ?? plaintext ?? statusText
  const header = response.headers.get('Retry-After')?.trim() ?? ''
  if (!/^\d+$/.test(header)) return new ApiError(response.status, message, body)
  const secs = Number(header)
  // 507 text already names the delay; repeating it would show the wait twice
  const named = message.includes(`retry in ${secs} s`)
  return new ApiError(response.status, named ? message : `${message} · retry in ${secs} s`, body, secs)
}

/** `cause` = Original-Fehlertext des Transports (z. B. Tauri-Scope-Denial) — er trägt die eigentliche Diagnose. */
export function networkApiError(cause?: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined
  return new ApiError(0, detail !== undefined && detail !== '' ? `server unreachable — ${detail}` : 'server unreachable')
}
