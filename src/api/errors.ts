export class ApiError extends Error {
  readonly status: number
  readonly body?: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function messageFromBody(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.message === 'string') return record.message
  }
  return undefined
}

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
  const plaintext = isJson || trimmed === '' ? undefined : trimmed
  return new ApiError(response.status, messageFromBody(body) ?? plaintext ?? statusText, body)
}

/** `cause` = Original-Fehlertext des Transports (z. B. Tauri-Scope-Denial) — er trägt die eigentliche Diagnose. */
export function networkApiError(cause?: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined
  return new ApiError(0, detail !== undefined && detail !== '' ? `server unreachable — ${detail}` : 'server unreachable')
}
