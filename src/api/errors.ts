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

/** Extracts the message from an error body object (`{error}`/`{message}`), also for openapi-fetch `error` values. */
export function messageFromBody(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.message === 'string') return record.message
  }
  return undefined
}

// LuraDB plain-text errors are one short line; the cap keeps foreign bodies (proxy HTML pages) out of inline messages.
const MAX_PLAINTEXT_MESSAGE = 300

/** Seconds of a numeric `Retry-After` header, otherwise undefined. */
export function retryAfterSecs(response: Response): number | undefined {
  const header = response.headers.get('Retry-After')?.trim() ?? ''
  return /^\d+$/.test(header) ? Number(header) : undefined
}

/** Builds an ApiError from a non-2xx response; consumes the body. LuraDB answers errors with plain text `NNN Reason: Detail`. */
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
  const secs = retryAfterSecs(response)
  if (secs === undefined) return new ApiError(response.status, message, body)
  // 507 text already names the delay; repeating it would show the wait twice
  const named = message.includes(`retry in ${secs} s`)
  return new ApiError(response.status, named ? message : `${message} · retry in ${secs} s`, body, secs)
}

/** `cause` = original transport error text (e.g. a Tauri scope denial); it carries the actual diagnosis. */
export function networkApiError(cause?: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined
  return new ApiError(0, detail !== undefined && detail !== '' ? `server unreachable — ${detail}` : 'server unreachable')
}
