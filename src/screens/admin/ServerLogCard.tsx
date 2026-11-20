import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, type ApiClient } from '../../api'
import { formatBytes } from '../../lib'
import { describeTail, serverLogFilesQueryOptions, serverLogTailQueryOptions, SERVER_LOG_FILES_KEY } from './serverLog'

type LinesOption = 100 | 250 | 1000

function parseLinesOption(value: string): LinesOption {
  if (value === '250') return 250
  if (value === '1000') return 1000
  return 100
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

const NO_LOG_FILE_TEXT = 'no luradb.log* file found'

function isNoLogFileYet(error: unknown): boolean {
  return error instanceof ApiError && error.status === 500 && error.message.includes(NO_LOG_FILE_TEXT)
}

/** SERVER LOG card: tail and file listing via `fetchSilent`. */
export function ServerLogCard({ apiClient }: { apiClient: ApiClient | undefined }) {
  const queryClient = useQueryClient()

  const [lines, setLines] = useState<LinesOption>(100)
  const [filterDraft, setFilterDraft] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | undefined>(undefined)
  const [fileGoneHint, setFileGoneHint] = useState(false)
  const hintSetAtRef = useRef(0)

  const tailQuery = useQuery(serverLogTailQueryOptions(apiClient, lines, committedQuery, selectedFile))
  const filesQuery = useQuery(serverLogFilesQueryOptions(apiClient))

  // File rotated/deleted (404 with a file param): fall back to the default, invalidate the file listing, set the hint.
  useEffect(() => {
    const error = tailQuery.error
    if (error instanceof ApiError && error.status === 404 && selectedFile !== undefined) {
      setSelectedFile(undefined)
      setFileGoneHint(true)
      hintSetAtRef.current = Date.now()
      void queryClient.invalidateQueries({ queryKey: SERVER_LOG_FILES_KEY })
    }
  }, [tailQuery.error, selectedFile, queryClient])

  // The hint disappears only on the next successful tail AFTER it was set;
  // the key switch back to the cached default carries an older dataUpdatedAt and does not clear it.
  useEffect(() => {
    if (tailQuery.dataUpdatedAt > hintSetAtRef.current) setFileGoneHint(false)
  }, [tailQuery.dataUpdatedAt])

  const bodyRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const lastKeyRef = useRef<string | undefined>(undefined)

  // Auto-scroll to the end: always on a controls change/first load, otherwise only if the container was already at the end.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || tailQuery.data === undefined) return
    const key = `${lines}|${committedQuery}|${selectedFile ?? ''}`
    const keyChanged = lastKeyRef.current !== key
    lastKeyRef.current = key
    if (keyChanged || atBottomRef.current) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a controls change alters the query key and so `data`; only `data` should trigger
  }, [tailQuery.data])

  function handleScroll(): void {
    const el = bodyRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }

  function commitFilter(value: string): void {
    setCommittedQuery(value)
    setFileGoneHint(false)
  }

  function clearFilter(): void {
    setFilterDraft('')
    setCommittedQuery('')
    setFileGoneHint(false)
  }

  const filesData = filesQuery.data
  const showFileSelect = !filesQuery.isError && (filesData?.length ?? 0) > 0

  const disabled =
    (tailQuery.error instanceof ApiError && tailQuery.error.status === 503) ||
    (filesQuery.error instanceof ApiError && filesQuery.error.status === 503)

  return (
    <div className="admin-card admin-log">
      <div className="admin-card__head">SERVER LOG · GET /store-api/logs</div>
      {disabled ? (
        <div className="admin-log__notice">log access disabled — set log.http_access = true (requires log.path) in luradb.toml</div>
      ) : (
        <>
          <div className="admin-log__controls">
            <select
              className="admin-log__select"
              aria-label="lines"
              value={String(lines)}
              onChange={(event) => {
                setLines(parseLinesOption(event.target.value))
                setFileGoneHint(false)
              }}
            >
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="1000">1000</option>
            </select>
            <div className="admin-log__filter">
              <input
                className="admin-log__filter-input"
                type="text"
                aria-label="filter"
                placeholder="filter (case-sensitive)"
                value={filterDraft}
                onChange={(event) => setFilterDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitFilter(filterDraft)
                }}
                onBlur={() => commitFilter(filterDraft)}
              />
              {filterDraft !== '' && (
                <button type="button" className="admin-log__filter-clear" title="clear filter" onClick={clearFilter}>
                  ×
                </button>
              )}
            </div>
            {showFileSelect && (
              <select
                className="admin-log__select"
                aria-label="log file"
                value={selectedFile ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedFile(value === '' ? undefined : value)
                  setFileGoneHint(false)
                }}
              >
                {(filesData ?? []).map((file, index) => (
                  <option key={file.file} value={index === 0 ? '' : file.file}>
                    {file.file} · {formatBytes(file.size)}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="admin-log__refresh" onClick={() => void tailQuery.refetch()}>
              refresh
            </button>
          </div>
          <div className="admin-log__body selectable" ref={bodyRef} onScroll={handleScroll}>
            {(tailQuery.data?.lines ?? []).map((line, index) => (
              <div key={index} className="admin-log__line">
                {line}
              </div>
            ))}
          </div>
          <div className="admin-log__foot">
            {fileGoneHint ? (
              <div className="admin-log__foot-line">file gone — showing newest</div>
            ) : tailQuery.isPlaceholderData ? (
              <div className="admin-log__foot-line">loading…</div>
            ) : tailQuery.isError ? (
              isNoLogFileYet(tailQuery.error) ? (
                <div className="admin-log__foot-line">no log file yet</div>
              ) : (
                <div className="admin-log__foot-line admin-log__foot-line--err">{messageOf(tailQuery.error)}</div>
              )
            ) : tailQuery.data ? (
              <>
                <div className="admin-log__foot-line">{describeTail(tailQuery.data, committedQuery)}</div>
                {tailQuery.data.truncated && <div className="admin-log__foot-line">older lines not scanned (4 MiB budget)</div>}
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
