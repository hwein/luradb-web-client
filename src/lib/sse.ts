/**
 * Events are invalidation signals; re-reading the affected data stays authoritative.
 * IDs order the stream, not the writes.
 * ID gaps are normal with filtered subscriptions and never a sign of loss; no catch-up logic is ever derived from them.
 */

export type SseConnectionState = 'connected' | 'reconnecting' | 'closed'

export type SseResetReason = 'restart' | 'window_exceeded' | 'lagged' | 'unknown_id' | 'unknown'

export type SseCloseReason = 'gone' | 'forbidden'

export interface SseEvent {
  /** Event name from `event:`; defaults to 'message' when the frame has no event line. */
  event: string
  /** Merged `data:` lines (joined with \n). */
  data: string
  /** `id:` field of the frame; `undefined` if the frame has none (or an empty one). */
  id?: string
}

export interface SseOpenContext {
  /** Last non-empty frame ID seen by this call; `undefined` on the first open and until an ID arrives. */
  lastEventId?: string
  /** First open `false`, each retry `true`, even without an ID. */
  reconnect: boolean
}

export interface SseStreamOptions {
  /** Opens the response (client infrastructure); Accept/Auth/recorder live there. */
  open: (path: string, context: SseOpenContext) => Promise<Response>
  /** Ends stream, reconnects and backoff timers for good. */
  signal: AbortSignal
  onEvent: (event: SseEvent) => void
  /** `event: reset`: discard what was derived from the stream and re-read. A state command, not an event. */
  onReset?: (reason: SseResetReason) => void
  onStateChange?: (state: SseConnectionState) => void
  /** Why the server ended the stream for good, called before `onStateChange('closed')`: 410 `gone`, 403 `forbidden`. */
  onClosed?: (reason: SseCloseReason) => void
  /** 401: server key invalid; the caller invalidates the session (like the QueryClient handler). */
  onUnauthorized?: () => void
}

const STABLE_RESET_MS = 60_000

/** 3x server keep-alive (~15 s): after that the stream counts as dead; a half-open connection never reports itself. */
const SSE_IDLE_TIMEOUT_MS = 45_000

/** `data` of the reset frame is best effort: any unknown, missing or broken value becomes 'unknown', never a throw. */
function resetReasonOf(data: string): SseResetReason {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return 'unknown'
  }
  if (typeof parsed !== 'object' || parsed === null || !('reason' in parsed)) return 'unknown'
  switch (parsed.reason) {
    case 'restart':
    case 'window_exceeded':
    case 'lagged':
    case 'unknown_id':
      return parsed.reason
    default:
      return 'unknown'
  }
}

/** Backoff ladder 1s → 2s → 5s (then 5s constant). */
function backoffDelay(attempt: number): number {
  if (attempt <= 0) return 1000
  if (attempt === 1) return 2000
  return 5000
}

/** setTimeout that resolves immediately on abort and leaves no zombie timer. `true` = ran to completion. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Reads the body line by line and dispatches SSE frames; returns when the server closes,
 * `SSE_IDLE_TIMEOUT_MS` passes without a chunk, or `signal` aborts (abort cancels the reader; the
 * signal is never passed to fetch, so foreign AbortSignal realms like jsdom/undici do not collide).
 */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  if (signal.aborted) {
    await reader.cancel().catch(() => {})
    return
  }
  const onAbort = (): void => void reader.cancel().catch(() => {})
  signal.addEventListener('abort', onAbort, { once: true })

  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = ''
  let eventId = ''
  let dataLines: string[] = []

  const dispatch = (): void => {
    if (dataLines.length > 0) {
      onEvent({
        event: eventType === '' ? 'message' : eventType,
        data: dataLines.join('\n'),
        id: eventId === '' ? undefined : eventId,
      })
    }
    eventType = ''
    eventId = ''
    dataLines = []
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdleTimer = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => void reader.cancel().catch(() => {}), SSE_IDLE_TIMEOUT_MS)
  }

  try {
    armIdleTimer()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      armIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') {
          dispatch()
          continue
        }
        if (line.startsWith(':')) continue // comment / keep-alive ping
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let val = colon === -1 ? '' : line.slice(colon + 1)
        if (val.startsWith(' ')) val = val.slice(1)
        if (field === 'event') eventType = val
        else if (field === 'data') dataLines.push(val)
        else if (field === 'id') eventId = val
        // retry is ignored: the server sends none, the backoff ladder below stays authoritative.
      }
    }
  } finally {
    clearTimeout(idleTimer)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Keeps an SSE stream open: parses frames, resumes with `last_event_id` after a drop and reconnects
 * with backoff 1s→2s→5s (reset after a stable minute), ends for good on 410 (domain deleted, reported
 * as `gone`), 403 (key may not read the stream, reported as `forbidden`) and 401 (session invalid, no reason).
 * A reconnect is triggered either by the stream ending or by 45 s without a chunk; a half-open connection
 * (server restart behind a proxy) would otherwise stay on `connected` forever.
 * The passed `signal` ends everything, including running backoff timers.
 */
export async function sseStream(path: string, options: SseStreamOptions): Promise<void> {
  const { open, signal, onEvent, onReset, onStateChange, onClosed, onUnauthorized } = options
  // Ladder position across reconnects; back to 0 only after a stable minute.
  let attempt = 0
  // Resume point for this call only; a domain/prefix change deliberately restarts without an ID.
  let lastEventId: string | undefined
  let opened = false

  const handleFrame = (frame: SseEvent): void => {
    // The reset frame also carries an ID (the current head); without adopting it the next open would loop on reset.
    if (frame.id !== undefined) lastEventId = frame.id
    if (frame.event === 'reset') {
      onReset?.(resetReasonOf(frame.data))
      return
    }
    onEvent(frame)
  }

  const backoff = async (): Promise<boolean> => {
    onStateChange?.('reconnecting')
    const delay = backoffDelay(attempt)
    attempt += 1
    return abortableDelay(delay, signal)
  }

  while (!signal.aborted) {
    let response: Response
    const context: SseOpenContext = { lastEventId, reconnect: opened }
    opened = true
    try {
      response = await open(path, context)
    } catch {
      if (!(await backoff())) return
      continue
    }
    if (signal.aborted) {
      await response.body?.cancel().catch(() => {})
      return
    }

    // 410: domain deleted (`gone`). 403: this key may not read the stream (`forbidden`). A reconnect changes neither.
    if (response.status === 410 || response.status === 403) {
      onClosed?.(response.status === 410 ? 'gone' : 'forbidden')
      onStateChange?.('closed')
      return
    }
    if (response.status === 401) {
      onUnauthorized?.()
      onStateChange?.('closed')
      return
    }
    if (!response.ok || response.body === null) {
      if (!(await backoff())) return
      continue
    }

    const connectedAt = Date.now()
    onStateChange?.('connected')
    try {
      await readFrames(response.body, handleFrame, signal)
    } catch {
      // Read/network failure mid-stream: treat like a normal stream end (reconnect).
    }
    if (signal.aborted) return
    if (Date.now() - connectedAt >= STABLE_RESET_MS) attempt = 0
    if (!(await backoff())) return
  }
}
