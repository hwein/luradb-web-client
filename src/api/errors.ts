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

/** Baut einen ApiError aus einer Nicht-2xx-Response; konsumiert den Body. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const statusText = response.statusText.length > 0 ? response.statusText : `HTTP ${response.status}`
  return new ApiError(response.status, messageFromBody(body) ?? statusText, body)
}

/** `cause` = Original-Fehlertext des Transports (z. B. Tauri-Scope-Denial) — er trägt die eigentliche Diagnose. */
export function networkApiError(cause?: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined
  return new ApiError(0, detail !== undefined && detail !== '' ? `server unreachable — ${detail}` : 'server unreachable')
}
