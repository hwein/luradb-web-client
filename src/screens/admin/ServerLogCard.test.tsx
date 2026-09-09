import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { ServerLogCard } from './ServerLogCard'

const ORIGIN = window.location.origin
const LOGS_URL = `${ORIGIN}/store-api/logs`
const FILES_URL = `${ORIGIN}/store-api/logs/files`

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function ConnectedServerLogCard() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <ServerLogCard apiClient={apiClient} />
}

function versionHandler(serverVersion = '0.4.0') {
  return http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: serverVersion }))
}

function tailBody(overrides: { file?: string; lines?: string[]; truncated?: boolean } = {}) {
  return { file: 'luradb.log', format: 'text', lines: [], truncated: false, ...overrides }
}

function emptyFiles() {
  return http.get(FILES_URL, () => HttpResponse.json({ files: [] }))
}

async function renderConnected(): Promise<QueryClient> {
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedServerLogCard />
    </QueryClientProvider>,
  )
  return queryClient
}

function lineTexts(): string[] {
  return [...document.querySelectorAll('.admin-log__line')].map((node) => node.textContent ?? '')
}

afterEach(() => {
  act(() => disconnect())
})

describe('ServerLogCard rendering', () => {
  it('renders lines and the "last N lines" footer', async () => {
    server.use(versionHandler(), emptyFiles(), http.get(LOGS_URL, () => HttpResponse.json(tailBody({ lines: ['line one', 'line two'] }))))
    await renderConnected()

    await screen.findByText('line one')
    expect(lineTexts()).toEqual(['line one', 'line two'])
    expect(screen.getByText('last 2 lines · luradb.log')).toBeInTheDocument()
  })

  it('shows "no matching lines" for an empty successful result', async () => {
    server.use(versionHandler(), emptyFiles(), http.get(LOGS_URL, () => HttpResponse.json(tailBody({ lines: [] }))))
    await renderConnected()

    expect(await screen.findByText('no matching lines')).toBeInTheDocument()
    expect(document.querySelector('.admin-log__line')).not.toBeInTheDocument()
  })

  it('shows the truncated hint alongside the normal footer line', async () => {
    server.use(versionHandler(), emptyFiles(), http.get(LOGS_URL, () => HttpResponse.json(tailBody({ lines: ['a'], truncated: true }))))
    await renderConnected()

    await screen.findByText('last 1 lines · luradb.log')
    expect(screen.getByText('older lines not scanned (4 MiB budget)')).toBeInTheDocument()
  })
})

describe('ServerLogCard controls', () => {
  it('sends lines but no file param by default, and reacts to lines/filter/clear/file changes', async () => {
    const searches: string[] = []
    server.use(
      versionHandler(),
      http.get(FILES_URL, () =>
        HttpResponse.json({
          files: [
            { file: 'luradb.log.b', size: 200, modified: 2 },
            { file: 'luradb.log.a', size: 100, modified: 1 },
          ],
        }),
      ),
      http.get(LOGS_URL, ({ request }) => {
        searches.push(new URL(request.url).search)
        return HttpResponse.json(tailBody({ lines: ['x'] }))
      }),
    )
    await renderConnected()
    await screen.findByText('x')
    expect(searches[0]).toBe('?lines=100')

    fireEvent.change(screen.getByLabelText('lines'), { target: { value: '250' } })
    await waitFor(() => expect(searches.at(-1)).toBe('?lines=250'))

    fireEvent.change(screen.getByLabelText('filter'), { target: { value: 'WARN' } })
    fireEvent.blur(screen.getByLabelText('filter'))
    await waitFor(() => {
      const params = new URLSearchParams(searches.at(-1))
      expect(params.get('q')).toBe('WARN')
    })

    fireEvent.click(screen.getByTitle('clear filter'))
    await waitFor(() => {
      const params = new URLSearchParams(searches.at(-1))
      expect(params.get('q')).toBeNull()
    })

    fireEvent.change(screen.getByLabelText('log file'), { target: { value: 'luradb.log.a' } })
    await waitFor(() => {
      const params = new URLSearchParams(searches.at(-1))
      expect(params.get('file')).toBe('luradb.log.a')
    })
  })

  it('commits the filter on Enter as well as on blur', async () => {
    const searches: string[] = []
    server.use(
      versionHandler(),
      emptyFiles(),
      http.get(LOGS_URL, ({ request }) => {
        searches.push(new URL(request.url).search)
        return HttpResponse.json(tailBody({ lines: [] }))
      }),
    )
    await renderConnected()
    await screen.findByText('no matching lines')

    fireEvent.change(screen.getByLabelText('filter'), { target: { value: 'INFO' } })
    fireEvent.keyDown(screen.getByLabelText('filter'), { key: 'Enter' })
    await waitFor(() => {
      const params = new URLSearchParams(searches.at(-1))
      expect(params.get('q')).toBe('INFO')
    })
  })

  it('hides the file select when the listing is empty, and shows it once files exist', async () => {
    server.use(versionHandler(), emptyFiles(), http.get(LOGS_URL, () => HttpResponse.json(tailBody())))
    await renderConnected()
    await screen.findByText('no matching lines')
    expect(screen.queryByLabelText('log file')).not.toBeInTheDocument()
  })

  it('hides the file select when the listing itself errors', async () => {
    server.use(
      versionHandler(),
      http.get(FILES_URL, () => HttpResponse.text('500 Internal Server Error', { status: 500 })),
      http.get(LOGS_URL, () => HttpResponse.json(tailBody())),
    )
    await renderConnected()
    await screen.findByText('no matching lines')
    expect(screen.queryByLabelText('log file')).not.toBeInTheDocument()
  })
})

describe('ServerLogCard keepPreviousData', () => {
  it('keeps old lines and shows "loading…" while a new request for a changed control is in flight', async () => {
    let call = 0
    let release: (() => void) | undefined
    server.use(
      versionHandler(),
      emptyFiles(),
      http.get(LOGS_URL, async () => {
        call += 1
        if (call === 1) return HttpResponse.json(tailBody({ lines: ['first line'] }))
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(tailBody({ lines: ['second line'] }))
      }),
    )
    await renderConnected()
    await screen.findByText('first line')

    fireEvent.change(screen.getByLabelText('lines'), { target: { value: '250' } })
    expect(await screen.findByText('loading…')).toBeInTheDocument()
    expect(screen.getByText('first line')).toBeInTheDocument()

    release?.()
    await waitFor(() => expect(screen.getByText('second line')).toBeInTheDocument())
    expect(screen.queryByText('first line')).not.toBeInTheDocument()
  })
})

describe('ServerLogCard disabled / old-server states', () => {
  it('shows the disabled notice for 503 and hides the controls', async () => {
    server.use(
      versionHandler(),
      http.get(FILES_URL, () => HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 })),
      http.get(LOGS_URL, () => HttpResponse.text('503 Service Unavailable: log access is disabled (log.http_access = false)', { status: 503 })),
    )
    await renderConnected()

    expect(await screen.findByText('log access disabled — set log.http_access = true (requires log.path) in luradb.toml')).toBeInTheDocument()
    expect(screen.queryByLabelText('lines')).not.toBeInTheDocument()
  })

  it('reports an old server from the tail 404 (no file param)', async () => {
    server.use(versionHandler('0.4.0'), emptyFiles(), http.get(LOGS_URL, () => HttpResponse.text('404 Not Found', { status: 404 })))
    await renderConnected()

    expect(await screen.findByText('requires LuraDB ≥ 0.3.0 (server is 0.4.0)')).toBeInTheDocument()
  })

  it('reports an old server from the unambiguous files-listing 404, even while the tail request never settles', async () => {
    server.use(
      versionHandler('0.4.0'),
      http.get(FILES_URL, () => HttpResponse.text('404 Not Found', { status: 404 })),
      http.get(LOGS_URL, () => new Promise(() => {})),
    )
    await renderConnected()

    expect(await screen.findByText('requires LuraDB ≥ 0.3.0 (server is 0.4.0)')).toBeInTheDocument()
  })
})

describe('ServerLogCard tail error states', () => {
  it('shows a muted empty state for a 500 "no luradb.log* file found" (fresh install, no file yet)', async () => {
    server.use(
      versionHandler(),
      emptyFiles(),
      http.get(LOGS_URL, () =>
        HttpResponse.text('500 Internal Server Error: log directory unreadable, no luradb.log* file found, or read failed', { status: 500 }),
      ),
    )
    await renderConnected()

    const foot = await screen.findByText('no log file yet')
    expect(foot.className).not.toContain('admin-log__foot-line--err')
    expect(document.querySelector('.admin-log__line')).not.toBeInTheDocument()
  })

  it('shows a red error for other 500s while keeping the last successful lines', async () => {
    let call = 0
    server.use(
      versionHandler(),
      emptyFiles(),
      http.get(LOGS_URL, () => {
        call += 1
        if (call === 1) return HttpResponse.json(tailBody({ lines: ['kept line'] }))
        return HttpResponse.text('500 Internal Server Error: disk full', { status: 500 })
      }),
    )
    await renderConnected()
    await screen.findByText('kept line')

    fireEvent.click(screen.getByText('refresh'))

    const errorNode = await screen.findByText('500 Internal Server Error: disk full')
    expect(errorNode.className).toContain('admin-log__foot-line--err')
    expect(screen.getByText('kept line')).toBeInTheDocument()
  })

  it('resets to the default file, invalidates the listing, and shows the "file gone" hint on a 404 with a file param', async () => {
    let filesCalls = 0
    let tailFile: string | null = null
    server.use(
      versionHandler(),
      http.get(FILES_URL, () => {
        filesCalls += 1
        return HttpResponse.json({
          files: [
            { file: 'luradb.log.b', size: 200, modified: 2 },
            { file: 'luradb.log.a', size: 100, modified: 1 },
          ],
        })
      }),
      http.get(LOGS_URL, ({ request }) => {
        tailFile = new URL(request.url).searchParams.get('file')
        if (tailFile === 'luradb.log.a') return HttpResponse.text('404 Not Found', { status: 404 })
        return HttpResponse.json(tailBody({ file: 'luradb.log.b', lines: ['from b'] }))
      }),
    )
    await renderConnected()
    await screen.findByText('from b')
    expect(filesCalls).toBe(1)

    fireEvent.change(screen.getByLabelText('log file'), { target: { value: 'luradb.log.a' } })

    expect(await screen.findByText('file gone — showing newest')).toBeInTheDocument()
    await waitFor(() => expect(filesCalls).toBe(2))
    await waitFor(() => expect(tailFile).toBeNull())
    await waitFor(() => expect((screen.getByLabelText('log file') as HTMLSelectElement).value).toBe(''))
  })
})
