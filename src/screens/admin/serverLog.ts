import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { ApiError, apiErrorFromResponse, BASE_PATH, type ApiClient } from '../../api'
import type { components } from '../../api/schema'

const LOGS_PATH = `${BASE_PATH}/logs`
const LOGS_FILES_PATH = `${BASE_PATH}/logs/files`

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g

/** Strip CSI sequences: log lines are shown as plain muted text, without level coloring. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, '')
}

export type LogFileInfo = components['schemas']['LogFileInfo']

export interface LogTail {
  file: string
  lines: string[]
  truncated: boolean
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isLogFileInfo(value: unknown): value is LogFileInfo {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isString(record.file) && typeof record.size === 'number' && typeof record.modified === 'number'
}

function parseFilesResponse(body: unknown, status: number): LogFileInfo[] {
  if (body === null || typeof body !== 'object') throw new ApiError(status, 'unexpected log files response')
  const files = (body as Record<string, unknown>).files
  if (!Array.isArray(files) || !files.every(isLogFileInfo)) throw new ApiError(status, 'unexpected log files response')
  return files
}

function parseLogResponse(body: unknown, status: number): LogTail {
  if (body === null || typeof body !== 'object') throw new ApiError(status, 'unexpected log response')
  const record = body as Record<string, unknown>
  if (!isString(record.file) || !Array.isArray(record.lines) || !record.lines.every(isString) || typeof record.truncated !== 'boolean') {
    throw new ApiError(status, 'unexpected log response')
  }
  return { file: record.file, lines: record.lines.map(stripAnsi), truncated: record.truncated }
}

/** Footer text; an empty result replaces "last N …" with "no matching lines". */
export function describeTail(tail: LogTail, q: string): string {
  if (tail.lines.length === 0) return 'no matching lines'
  return q === '' ? `last ${tail.lines.length} lines · ${tail.file}` : `last ${tail.lines.length} matches for "${q}" · ${tail.file}`
}

function tailPath(lines: number, q: string, file: string | undefined): string {
  const params = new URLSearchParams({ lines: String(lines) })
  if (q !== '') params.set('q', q)
  if (file !== undefined) params.set('file', file)
  return `${LOGS_PATH}?${params.toString()}`
}

/**
 * Tail fetch via `fetchSilent` (10 s polling must not flood RECENT REQUESTS); throws `ApiError(status, plaintextBody)`
 * on non-2xx so the last successful lines stay as query `data`. The card classifies the error (disabled, file gone, …)
 * by `status`/`message` (precedent kvBulk.ts).
 */
export async function fetchServerLogTail(apiClient: ApiClient, lines: number, q: string, file: string | undefined): Promise<LogTail> {
  const response = await apiClient.fetchSilent(tailPath(lines, q, file))
  if (!response.ok) throw await apiErrorFromResponse(response)
  return parseLogResponse(await response.json(), response.status)
}

export async function fetchServerLogFiles(apiClient: ApiClient): Promise<LogFileInfo[]> {
  const response = await apiClient.fetchSilent(LOGS_FILES_PATH)
  if (!response.ok) throw await apiErrorFromResponse(response)
  return parseFilesResponse(await response.json(), response.status)
}

/** 503 (feature off) pauses the interval; the focus refetch stays active and heals once the operator switches the feature on. */
export function tailRefetchInterval(query: { state: { error: unknown } }): number | false {
  const error = query.state.error
  return error instanceof ApiError && error.status === 503 ? false : 10_000
}

export function serverLogTailQueryOptions(apiClient: ApiClient | undefined, lines: number, q: string, file: string | undefined) {
  return queryOptions({
    queryKey: ['server-log', 'tail', lines, q, file ?? ''] as const,
    queryFn: () => {
      if (!apiClient) throw new Error('server log query requires an active connection')
      return fetchServerLogTail(apiClient, lines, q, file)
    },
    enabled: apiClient !== undefined,
    placeholderData: keepPreviousData,
    refetchInterval: tailRefetchInterval,
  })
}

export const SERVER_LOG_FILES_KEY = ['server-log', 'files'] as const

export function serverLogFilesQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: SERVER_LOG_FILES_KEY,
    queryFn: () => {
      if (!apiClient) throw new Error('server log files query requires an active connection')
      return fetchServerLogFiles(apiClient)
    },
    enabled: apiClient !== undefined,
  })
}
