/**
 * Events sind Invalidierungssignale — das Re-Read der betroffenen Daten bleibt verbindlich.
 * IDs ordnen den Stream, nicht die Writes.
 * ID-Lücken sind bei gefilterten Abos Normalbetrieb und nie ein Verlust-Indiz — daraus wird nie eine Nachlade-Logik abgeleitet.
 */

export type SseConnectionState = 'connected' | 'reconnecting' | 'closed'

export type SseResetReason = 'restart' | 'window_exceeded' | 'lagged' | 'unknown_id' | 'unknown'

export interface SseEvent {
  /** Event-Name aus `event:`; Default 'message' wenn keine event-Zeile im Frame steht. */
  event: string
  /** Zusammengeführte `data:`-Zeilen (mit \n verbunden). */
  data: string
  /** `id:`-Feld des Frames; `undefined`, wenn der Frame keins (oder ein leeres) trägt. */
  id?: string
}

export interface SseOpenContext {
  /** Zuletzt gesehene nicht-leere Frame-ID dieses Aufrufs; `undefined` beim Erst-Open und solange keine ID kam. */
  lastEventId?: string
  /** Erst-Open `false`, jeder weitere Versuch `true` — auch ohne ID. */
  reconnect: boolean
}

export interface SseStreamOptions {
  /** Öffnet die Response (Client-Infrastruktur aus general/003) — Accept/Auth/Recorder liegen dort. */
  open: (path: string, context: SseOpenContext) => Promise<Response>
  /** Beendet Stream, Reconnects und Backoff-Timer endgültig. */
  signal: AbortSignal
  onEvent: (event: SseEvent) => void
  /** `event: reset` — verwirf, was aus dem Stream abgeleitet wurde, und lies neu. Kein Event, sondern ein Zustandsbefehl. */
  onReset?: (reason: SseResetReason) => void
  onStateChange?: (state: SseConnectionState) => void
  /** 401: Server-Key ungültig — der Aufrufer invalidiert die Session (wie der QueryClient-Handler). */
  onUnauthorized?: () => void
}

const STABLE_RESET_MS = 60_000

/** `data` des reset-Frames ist best effort — jeder unbekannte, fehlende oder kaputte Wert wird 'unknown', nie ein Wurf. */
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
        else if (field === 'id') eventId = val
        // retry ignoriert — der Server sendet keins, die Backoff-Ladder unten bleibt maßgeblich.
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Hält einen SSE-Stream offen: parst Frames, nimmt nach Abbruch mit `last_event_id` wieder auf und verbindet
 * mit Backoff 1s→2s→5s neu (Reset nach stabiler Minute), endet endgültig bei 410 (Domäne gelöscht),
 * 403 (Key ohne Stream-Recht) und 401 (Session ungültig).
 * Der übergebene `signal` beendet alles — auch laufende Backoff-Timer.
 */
export async function sseStream(path: string, options: SseStreamOptions): Promise<void> {
  const { open, signal, onEvent, onReset, onStateChange, onUnauthorized } = options
  // Ladder-Position über Reconnects hinweg; nur nach stabiler Minute zurück auf 0.
  let attempt = 0
  // Resume-Punkt nur für diesen Aufruf — ein Domänen-/Prefix-Wechsel startet bewusst ohne ID neu.
  let lastEventId: string | undefined
  let opened = false

  const handleFrame = (frame: SseEvent): void => {
    // Auch der reset-Frame trägt eine ID (den aktuellen Kopf) — ohne Übernahme liefe der nächste Open in eine Reset-Schleife.
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

    // 410: Domäne gelöscht. 403: dieser Key darf den Stream nicht — beides ändert kein Reconnect.
    if (response.status === 410 || response.status === 403) {
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
      // Lese-/Netzwerkabbruch mitten im Stream — wie ein normales Stream-Ende behandeln (reconnect).
    }
    if (signal.aborted) return
    if (Date.now() - connectedAt >= STABLE_RESET_MS) attempt = 0
    if (!(await backoff())) return
  }
}
