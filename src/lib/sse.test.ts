import { afterEach, describe, expect, it, vi } from 'vitest'
import { sseStream, type SseConnectionState, type SseEvent } from './sse'

const encoder = new TextEncoder()

/** Response, deren Body die Chunks liefert und danach schließt (Server beendet den Stream). */
function closedStream(...chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

/** Response mit offenem Body — Test steuert push/close von Hand. */
function controllableStream(): { response: Response; push: (chunk: string) => void; close: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, { status: 200 }),
    push: (chunk) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sseStream parsing', () => {
  it('parses set/delete, joins multiline data, defaults event to message, ignores comment pings', async () => {
    vi.useFakeTimers()
    const events: SseEvent[] = []
    const open = vi
      .fn<(path: string) => Promise<Response>>()
      .mockResolvedValueOnce(
        closedStream('event: set\ndata: k1\n\n', ':\n\n', 'event: delete\ndata: k2\n\n', 'data: a\ndata: b\n\n'),
      )
      .mockResolvedValue(new Response(null, { status: 410 }))

    const promise = sseStream('/watch', { open, signal: new AbortController().signal, onEvent: (e) => events.push(e) })
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(events).toEqual([
      { event: 'set', data: 'k1' },
      { event: 'delete', data: 'k2' },
      { event: 'message', data: 'a\nb' },
    ])
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    vi.useFakeTimers()
    const events: SseEvent[] = []
    const open = vi
      .fn<(path: string) => Promise<Response>>()
      .mockResolvedValueOnce(closedStream('eve', 'nt: set\nda', 'ta: split', 'key\n', '\n'))
      .mockResolvedValue(new Response(null, { status: 410 }))

    const promise = sseStream('/watch', { open, signal: new AbortController().signal, onEvent: (e) => events.push(e) })
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(events).toEqual([{ event: 'set', data: 'splitkey' }])
  })

  it('tolerates CRLF line endings', async () => {
    vi.useFakeTimers()
    const events: SseEvent[] = []
    const open = vi
      .fn<(path: string) => Promise<Response>>()
      .mockResolvedValueOnce(closedStream('event: set\r\ndata: k\r\n\r\n'))
      .mockResolvedValue(new Response(null, { status: 410 }))

    const promise = sseStream('/watch', { open, signal: new AbortController().signal, onEvent: (e) => events.push(e) })
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(events).toEqual([{ event: 'set', data: 'k' }])
  })
})

describe('sseStream reconnect', () => {
  it('reconnects after the server closes the stream (no resume) and reports state', async () => {
    vi.useFakeTimers()
    const events: SseEvent[] = []
    const states: SseConnectionState[] = []
    const open = vi
      .fn<(path: string) => Promise<Response>>()
      .mockResolvedValueOnce(closedStream('event: set\ndata: k1\n\n'))
      .mockResolvedValueOnce(closedStream('event: set\ndata: k2\n\n'))
      .mockResolvedValue(new Response(null, { status: 410 }))

    const promise = sseStream('/watch', {
      open,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      onStateChange: (s) => states.push(s),
    })
    await vi.advanceTimersByTimeAsync(1000 + 2000)
    await promise

    expect(events).toEqual([
      { event: 'set', data: 'k1' },
      { event: 'set', data: 'k2' },
    ])
    expect(open).toHaveBeenCalledTimes(3)
    expect(states).toEqual(['connected', 'reconnecting', 'connected', 'reconnecting', 'closed'])
  })

  it('follows the backoff ladder 1s → 2s → 5s (max) between reconnects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const openTimes: number[] = []
    const controller = new AbortController()
    const open = vi.fn(async () => {
      openTimes.push(Date.now())
      return closedStream()
    })

    const promise = sseStream('/watch', { open, signal: controller.signal, onEvent: () => {} })
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000 + 5000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await promise

    expect(openTimes).toEqual([0, 1000, 3000, 8000, 13000])
  })

  it('resets the ladder to 1s after a stable minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const openTimes: number[] = []
    let call = 0
    const stable = controllableStream()
    const open = vi.fn(async () => {
      openTimes.push(Date.now())
      call += 1
      if (call <= 2) return closedStream() // two quick drops advance the ladder to 5s next
      if (call === 3) return stable.response // stays open for a stable minute
      return new Response(null, { status: 410 })
    })

    const promise = sseStream('/watch', { open, signal: new AbortController().signal, onEvent: () => {} })
    await vi.advanceTimersByTimeAsync(3000) // opens at 0, 1000, 3000 (now connected & stable)
    await vi.advanceTimersByTimeAsync(61000) // hold the connection past the 60s reset threshold
    stable.close()
    await vi.advanceTimersByTimeAsync(1000) // reset ⇒ next backoff is 1s, not 5s
    await promise

    expect(openTimes).toEqual([0, 1000, 3000, 65000])
  })
})

describe('sseStream terminal statuses', () => {
  it('closes permanently on 410 without reconnecting', async () => {
    vi.useFakeTimers()
    const states: SseConnectionState[] = []
    const open = vi.fn(async () => new Response(null, { status: 410 }))

    const promise = sseStream('/watch', {
      open,
      signal: new AbortController().signal,
      onEvent: () => {},
      onStateChange: (s) => states.push(s),
    })
    await promise
    await vi.advanceTimersByTimeAsync(10_000)

    expect(open).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['closed'])
  })

  it('closes and signals unauthorized on 401', async () => {
    vi.useFakeTimers()
    const onUnauthorized = vi.fn()
    const states: SseConnectionState[] = []
    const open = vi.fn(async () => new Response(null, { status: 401 }))

    const promise = sseStream('/watch', {
      open,
      signal: new AbortController().signal,
      onEvent: () => {},
      onStateChange: (s) => states.push(s),
      onUnauthorized,
    })
    await promise
    await vi.advanceTimersByTimeAsync(10_000)

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['closed'])
  })
})

describe('sseStream abort', () => {
  it('never opens when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const open = vi.fn(async () => closedStream())

    await sseStream('/watch', { open, signal: controller.signal, onEvent: () => {} })

    expect(open).not.toHaveBeenCalled()
  })

  it('cancels a pending backoff timer on abort and does not reconnect', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const open = vi.fn(async () => closedStream()) // drop immediately ⇒ schedules a backoff

    const promise = sseStream('/watch', { open, signal: controller.signal, onEvent: () => {} })
    await vi.advanceTimersByTimeAsync(0) // first open + drop, 1s backoff now pending
    expect(open).toHaveBeenCalledTimes(1)

    controller.abort()
    await vi.advanceTimersByTimeAsync(10_000) // timer must be gone — no second open
    await promise

    expect(open).toHaveBeenCalledTimes(1)
  })

  it('cancels the reader and stops when aborted mid-stream (no reconnect)', async () => {
    const events: SseEvent[] = []
    const states: SseConnectionState[] = []
    const controller = new AbortController()
    const stream = controllableStream()
    const open = vi.fn(async () => stream.response)

    const promise = sseStream('/watch', {
      open,
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      onStateChange: (s) => states.push(s),
    })
    stream.push('event: set\ndata: k1\n\n')
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controller.abort()
    await promise

    expect(events).toEqual([{ event: 'set', data: 'k1' }])
    expect(states).toEqual(['connected'])
    expect(open).toHaveBeenCalledTimes(1)
  })
})
