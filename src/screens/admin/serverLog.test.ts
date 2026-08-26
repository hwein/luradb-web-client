import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api'
import { createApi } from '../../api/client'
import { server } from '../../test/msw'
import {
  describeTail,
  fetchServerLogFiles,
  fetchServerLogTail,
  serverLogTailQueryOptions,
  stripAnsi,
  tailRefetchInterval,
  type LogTail,
} from './serverLog'

const BASE_URL = 'http://127.0.0.1:3000'

function makeApi() {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

describe('stripAnsi', () => {
  it('removes CSI sequences (ESC + [ + params + letter)', () => {
    expect(stripAnsi('\u001b[2m2026-08-26T11:10:15Z\u001b[0m \u001b[32m INFO\u001b[0m wal group-commit')).toBe(
      '2026-08-26T11:10:15Z  INFO wal group-commit',
    )
  })

  it('strips multiple distinct sequences within a single line', () => {
    expect(stripAnsi('\u001b[2m\u001b[0m\u001b[32mtext\u001b[3mmore\u001b[0m')).toBe('textmore')
  })

  it('leaves a line with literal brackets but no ESC byte fully intact', () => {
    expect(stripAnsi('[INFO] plain line without escape')).toBe('[INFO] plain line without escape')
  })

  it('does not touch a bare ESC not followed by a CSI-shaped sequence', () => {
    expect(stripAnsi('a\u001bb')).toBe('a\u001bb')
  })
})

describe('describeTail', () => {
  function tail(overrides: Partial<LogTail> = {}): LogTail {
    return { file: 'luradb.log', lines: ['a', 'b'], truncated: false, ...overrides }
  }

  it('reports a plain line count without a filter', () => {
    expect(describeTail(tail({ lines: ['a', 'b', 'c'] }), '')).toBe('last 3 lines · luradb.log')
  })

  it('reports matches when a filter is active', () => {
    expect(describeTail(tail({ lines: ['a'] }), 'WARN')).toBe('last 1 matches for "WARN" · luradb.log')
  })

  it('reports no matching lines for an empty result, even with a filter', () => {
    expect(describeTail(tail({ lines: [] }), 'WARN')).toBe('no matching lines')
    expect(describeTail(tail({ lines: [] }), '')).toBe('no matching lines')
  })
})

describe('tailRefetchInterval', () => {
  it('stops on 503 regardless of the file param', () => {
    expect(tailRefetchInterval(undefined)({ state: { error: new ApiError(503, 'disabled') } })).toBe(false)
    expect(tailRefetchInterval('luradb.log.1')({ state: { error: new ApiError(503, 'disabled') } })).toBe(false)
  })

  it('stops on 404 only when no file param was sent (old-server heuristic)', () => {
    expect(tailRefetchInterval(undefined)({ state: { error: new ApiError(404, 'not found') } })).toBe(false)
    expect(tailRefetchInterval('luradb.log.1')({ state: { error: new ApiError(404, 'file gone') } })).toBe(10_000)
  })

  it('keeps polling with no error and with unrelated errors', () => {
    expect(tailRefetchInterval(undefined)({ state: { error: null } })).toBe(10_000)
    expect(tailRefetchInterval(undefined)({ state: { error: new ApiError(500, 'boom') } })).toBe(10_000)
  })
})

describe('serverLogTailQueryOptions', () => {
  it('stays enabled regardless of error state', () => {
    expect(serverLogTailQueryOptions(makeApi(), 100, '', undefined).enabled).toBe(true)
    expect(serverLogTailQueryOptions(undefined, 100, '', undefined).enabled).toBe(false)
  })
})

describe('fetchServerLogTail', () => {
  it('sends lines but omits q/file when at their defaults', async () => {
    let search = ''
    server.use(
      http.get(`${BASE_URL}/store-api/logs`, ({ request }) => {
        search = new URL(request.url).search
        return HttpResponse.json({ file: 'luradb.log', format: 'text', lines: [], truncated: false })
      }),
    )
    await fetchServerLogTail(makeApi(), 100, '', undefined)
    expect(search).toBe('?lines=100')
  })

  it('includes q and file when set', async () => {
    let search = ''
    server.use(
      http.get(`${BASE_URL}/store-api/logs`, ({ request }) => {
        search = new URL(request.url).search
        return HttpResponse.json({ file: 'luradb.log.1', format: 'text', lines: [], truncated: false })
      }),
    )
    await fetchServerLogTail(makeApi(), 250, 'WARN', 'luradb.log.1')
    const params = new URLSearchParams(search)
    expect(params.get('lines')).toBe('250')
    expect(params.get('q')).toBe('WARN')
    expect(params.get('file')).toBe('luradb.log.1')
  })

  it('strips ANSI from every line and keeps file/truncated as-is', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/logs`, () =>
        HttpResponse.json({
          file: 'luradb.log',
          format: 'text',
          lines: ['\u001b[2m2026-08-26T11:10:15Z\u001b[0m \u001b[32m INFO\u001b[0m wal group-commit'],
          truncated: true,
        }),
      ),
    )
    const result = await fetchServerLogTail(makeApi(), 100, '', undefined)
    expect(result).toEqual({ file: 'luradb.log', lines: ['2026-08-26T11:10:15Z  INFO wal group-commit'], truncated: true })
  })

  it('throws ApiError(status, plaintextBody) on a 503 (feature disabled)', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/logs`, () =>
        HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 }),
      ),
    )
    await expect(fetchServerLogTail(makeApi(), 100, '', undefined)).rejects.toMatchObject({
      status: 503,
      message: '503 Service Unavailable: log access is disabled (log.http_access = false)',
    })
  })

  it('throws ApiError(status, plaintextBody) on a 500 "no luradb.log* file found"', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/logs`, () =>
        HttpResponse.text('500 Internal Server Error: log directory unreadable, no luradb.log* file found, or read failed', { status: 500 }),
      ),
    )
    await expect(fetchServerLogTail(makeApi(), 100, '', undefined)).rejects.toMatchObject({
      status: 500,
      message: '500 Internal Server Error: log directory unreadable, no luradb.log* file found, or read failed',
    })
  })

  it('throws a status-0 ApiError on a network failure', async () => {
    server.use(http.get(`${BASE_URL}/store-api/logs`, () => HttpResponse.error()))
    await expect(fetchServerLogTail(makeApi(), 100, '', undefined)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('fetchServerLogFiles', () => {
  it('parses the files listing', async () => {
    server.use(
      http.get(`${BASE_URL}/store-api/logs/files`, () =>
        HttpResponse.json({ files: [{ file: 'luradb.log.2026-08-26', size: 3369, modified: 1787742615 }] }),
      ),
    )
    await expect(fetchServerLogFiles(makeApi())).resolves.toEqual([{ file: 'luradb.log.2026-08-26', size: 3369, modified: 1787742615 }])
  })

  it('throws ApiError(status, plaintextBody) on a 404 (old server, route missing)', async () => {
    server.use(http.get(`${BASE_URL}/store-api/logs/files`, () => HttpResponse.text('404 Not Found', { status: 404 })))
    await expect(fetchServerLogFiles(makeApi())).rejects.toMatchObject({ status: 404, message: '404 Not Found' })
  })
})
