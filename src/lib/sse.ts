export type SseConnectionState = 'connected' | 'reconnecting' | 'closed'

export interface SseEvent {
  /** Event-Name aus `event:`; Default 'message' wenn keine event-Zeile im Frame steht. */
  event: string
  /** Zusammengeführte `data:`-Zeilen (mit \n verbunden). */
  data: string
}

export interface SseStreamOptions {
  /** Öffnet die Response (Client-Infrastruktur aus general/003) — Accept/Auth/Recorder liegen dort. */
  open: (path: string) => Promise<Response>
  /** Beendet Stream, Reconnects und Backoff-Timer endgültig. */
  signal: AbortSignal
  onEvent: (event: SseEvent) => void
  onStateChange?: (state: SseConnectionState) => void
  /** 401: Server-Key ungültig — der Aufrufer invalidiert die Session (wie der QueryClient-Handler). */
  onUnauthorized?: () => void
}

const STABLE_RESET_MS = 60_000

/** Backoff-Ladder 1s → 2s → 5s (danach konstant 5s). */
function backoffDelay(attempt: number): number {
  if (attempt <= 0) return 1000
  if (attempt === 1) return 2000
  return 5000
}

/** setTimeout, das bei Abort sofort auflöst und keinen Zombie-Timer hinterlässt. Resolve `true` = durchgelaufen. */
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
 * Liest den Body zeilenweise und dispatcht SSE-Frames; kehrt zurück, wenn der Server schließt oder
 * `signal` abbricht (Abbruch cancelt den Reader — der Signal wird nie an fetch gereicht, damit
 * fremde AbortSignal-Realms wie jsdom/undici nicht kollidieren).
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
  let dataLines: string[] = []

  const dispatch = (): void => {
    if (dataLines.length > 0) onEvent({ event: eventType === '' ? 'message' : eventType, data: dataLines.join('\n') })
    eventType = ''
    dataLines = []
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
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
        if (line.startsWith(':')) continue // Kommentar / Keep-Alive-Ping
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let val = colon === -1 ? '' : line.slice(colon + 1)
        if (val.startsWith(' ')) val = val.slice(1)
        if (field === 'event') eventType = val
        else if (field === 'data') dataLines.push(val)
        // id/retry ignoriert — kein Resume (Server sendet keine Event-IDs)
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Hält einen SSE-Stream offen: parst Frames, verbindet nach Abbruch mit Backoff 1s→2s→5s neu
 * (Reset nach stabiler Minute), endet endgültig bei 410 (Domäne gelöscht) und 401 (Session ungültig).
 * Der übergebene `signal` beendet alles — auch laufende Backoff-Timer.
 */
export async function sseStream(path: string, options: SseStreamOptions): Promise<void> {
  const { open, signal, onEvent, onStateChange, onUnauthorized } = options
  // Ladder-Position über Reconnects hinweg; nur nach stabiler Minute zurück auf 0.
  let attempt = 0

  const backoff = async (): Promise<boolean> => {
    onStateChange?.('reconnecting')
    const delay = backoffDelay(attempt)
    attempt += 1
    return abortableDelay(delay, signal)
  }

  while (!signal.aborted) {
    let response: Response
    try {
      response = await open(path)
    } catch {
      if (!(await backoff())) return
      continue
    }
    if (signal.aborted) {
      await response.body?.cancel().catch(() => {})
      return
    }

    if (response.status === 410) {
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
      await readFrames(response.body, onEvent, signal)
    } catch {
      // Lese-/Netzwerkabbruch mitten im Stream — wie ein normales Stream-Ende behandeln (reconnect).
    }
    if (signal.aborted) return
    if (Date.now() - connectedAt >= STABLE_RESET_MS) attempt = 0
    if (!(await backoff())) return
  }
}
