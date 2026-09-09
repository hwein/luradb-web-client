import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { clearRestoreEntry, noteRestoreStarted, type BackupSummary } from './backups'
import { BackupsCard } from './BackupsCard'

const ORIGIN = window.location.origin
const BACKUPS_URL = `${ORIGIN}/store-api/backups`

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function ConnectedBackupsCard() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <BackupsCard apiClient={apiClient} />
}

function baseHandlers() {
  return [
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'logs', created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
  ]
}

async function renderConnected(): Promise<QueryClient> {
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedBackupsCard />
    </QueryClientProvider>,
  )
  return queryClient
}

function backup(overrides: Partial<BackupSummary> = {}): BackupSummary {
  return { id: 'bk_a', state: 'complete', scope: 'all', created_at: 1, size_bytes: 2048, format_version: 1, schedule: null, ...overrides }
}

function atToday(hours: number, minutes: number): number {
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

function atYesterday(hours: number, minutes: number): number {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  date.setHours(hours, minutes, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

function labels(): string[] {
  return [...document.querySelectorAll('.admin-backups__label')].map((node) => node.textContent ?? '')
}

// Die Restore-Registry ist ein Modul-Singleton — vor jedem Test zurücksetzen (Muster src/lib/tasks.ts-Tests).
beforeEach(() => clearRestoreEntry())

afterEach(() => {
  act(() => disconnect())
})

describe('BackupsCard list', () => {
  it('renders rows newest first with state dots, schedule suffix and size', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () =>
        HttpResponse.json({
          backups: [
            backup({ id: 'bk_old', scope: 'kv', created_at: Math.floor(new Date(2020, 0, 15, 3, 5).getTime() / 1000), state: 'quantum' }),
            backup({ id: 'bk_new', scope: 'all', created_at: atToday(2, 0), size_bytes: 2_040_109_465, schedule: 'daily' }),
            backup({ id: 'bk_mid', scope: 'json:logs', created_at: atYesterday(2, 0), state: 'incomplete', size_bytes: 1024 }),
          ],
          running: null,
        }),
      ),
    )
    await renderConnected()

    await screen.findByText(/all · today 02:00/)
    expect(labels()).toEqual(['all · today 02:00 · daily', 'json:logs · yesterday 02:00', 'kv · 2020-01-15 03:05'])
    expect(screen.getByText('1.9 GB')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB')).toBeInTheDocument()

    const dots = [...document.querySelectorAll('.admin-backups__dot')]
    expect(dots[0]?.className).toContain('admin-backups__dot--ok')
    expect(dots[1]?.className).toContain('admin-backups__dot--err')
    expect(dots[1]).toHaveAttribute('title', 'checksum missing — incomplete')
    expect(dots[2]?.className).toContain('admin-backups__dot--muted')
  })

  it('shows the empty hint when there are no archives', async () => {
    server.use(...baseHandlers(), http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [] })))
    await renderConnected()

    expect(await screen.findByText('no backups yet')).toBeInTheDocument()
    expect(document.querySelector('.admin-backups__dot')).not.toBeInTheDocument()
  })

  it('renders a running job row with elapsed time and blocks run/restore while it runs', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () =>
        HttpResponse.json({
          backups: [backup({ id: 'bk_done', created_at: atToday(1, 0) })],
          running: { id: 'bk_running', scope: 'kv:shop', started_at: Math.floor(Date.now() / 1000) - 90 },
        }),
      ),
    )
    await renderConnected()

    expect(await screen.findByText('kv:shop · running')).toBeInTheDocument()
    expect(screen.getByText('1:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '▶ run backup now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'restore' })).toBeDisabled()
  })

  it('shows the disabled notice for 503 and hides the card actions', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.text('503 Service Unavailable: backup is disabled (backup.enabled = false)', { status: 503 })),
    )
    await renderConnected()

    expect(await screen.findByText('backups disabled — set backup.enabled = true in luradb.toml')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '▶ run backup now' })).not.toBeInTheDocument()
  })

  it('reports an old server for 404 including its version', async () => {
    server.use(...baseHandlers(), http.get(BACKUPS_URL, () => HttpResponse.text('404 Not Found', { status: 404 })))
    await renderConnected()

    expect(await screen.findByText('requires LuraDB ≥ 0.3.0 (server is 0.4.0)')).toBeInTheDocument()
  })
})

describe('BackupsCard run backup now', () => {
  it('sends include_auth only for the exact all/kv scopes and disables the checkbox otherwise', async () => {
    const bodies: unknown[] = []
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(BACKUPS_URL, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ id: 'bk_new', state: 'running' }, { status: 202 })
      }),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    const auth = screen.getByLabelText('include auth records')
    expect(auth).toBeEnabled()
    fireEvent.click(auth)

    fireEvent.click(screen.getByRole('button', { name: 'kv' }))
    expect(screen.getByLabelText('include auth records')).toBeEnabled()

    await screen.findByRole('option', { name: 'shop' })
    fireEvent.change(screen.getByLabelText('backup domain'), { target: { value: 'shop' } })
    expect(screen.getByLabelText('include auth records')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await waitFor(() => expect(bodies).toEqual([{ scope: 'kv:shop' }]))
  })

  it('offers only the engine domains for kv/json and the union for domain scope', async () => {
    const bodies: unknown[] = []
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(BACKUPS_URL, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ id: 'bk_new', state: 'running' }, { status: 202 })
      }),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    fireEvent.click(screen.getByRole('button', { name: 'json' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'logs' })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: 'shop' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'domain' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'shop' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'logs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'start' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('backup domain'), { target: { value: 'logs' } })
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await waitFor(() => expect(bodies).toEqual([{ scope: 'domain:logs' }]))
  })

  it('sends include_auth for the plain all scope', async () => {
    const bodies: unknown[] = []
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(BACKUPS_URL, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ id: 'bk_new', state: 'running' }, { status: 202 })
      }),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    fireEvent.click(screen.getByLabelText('include auth records'))
    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    await waitFor(() => expect(bodies).toEqual([{ scope: 'all', include_auth: true }]))
  })

  it('shows a 409 backup_busy inline and keeps the form open', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(BACKUPS_URL, () => HttpResponse.text('409 Conflict: backup_busy', { status: 409 })),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    expect(await screen.findByText('409 Conflict: backup_busy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'start' })).toBeInTheDocument()
  })

  it('keeps the card usable when a run fails with 503 json_engine_disabled', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(BACKUPS_URL, () =>
        HttpResponse.text('503 Service Unavailable: scope requires the JSON engine, which is disabled', { status: 503 }),
      ),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    fireEvent.click(screen.getByRole('button', { name: 'json' }))
    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    expect(await screen.findByText('503 Service Unavailable: scope requires the JSON engine, which is disabled')).toBeInTheDocument()
    expect(screen.queryByText('backups disabled — set backup.enabled = true in luradb.toml')).not.toBeInTheDocument()
  })

  it('refreshes the domain lists when the scope target vanished (404)', async () => {
    let domainCalls = 0
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })),
      http.get(`${ORIGIN}/store-api/domains`, () => {
        domainCalls += 1
        return HttpResponse.json([{ name: 'shop', created_at: 1 }])
      }),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(BACKUPS_URL, () => HttpResponse.text("404 Not Found: domain 'shop' no longer exists", { status: 404 })),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    fireEvent.click(screen.getByRole('button', { name: 'kv' }))
    await screen.findByRole('option', { name: 'shop' })
    expect(domainCalls).toBe(1)
    fireEvent.change(screen.getByLabelText('backup domain'), { target: { value: 'shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    expect(await screen.findByText("404 Not Found: domain 'shop' no longer exists")).toBeInTheDocument()
    await waitFor(() => expect(domainCalls).toBe(2))
  })

  it('polls until the job is done and stops without an extra invalidate', async () => {
    let listCalls = 0
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => {
        listCalls += 1
        if (listCalls === 1) return HttpResponse.json({ backups: [], running: null })
        if (listCalls === 2) return HttpResponse.json({ backups: [], running: { id: 'bk_new', scope: 'all', started_at: 1 } })
        return HttpResponse.json({ backups: [backup({ id: 'bk_new', created_at: atToday(4, 30) })], running: null })
      }),
      http.post(BACKUPS_URL, () => HttpResponse.json({ id: 'bk_new', state: 'running' }, { status: 202 })),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '▶ run backup now' }))
    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    expect(await screen.findByText('all · running')).toBeInTheDocument()
    expect(await screen.findByText('all · today 04:30', undefined, { timeout: 6000 })).toBeInTheDocument()
    expect(listCalls).toBe(3)
  })
})

describe('BackupsCard row actions', () => {
  it('downloads an archive as <id>.ndjson and disables the button meanwhile', async () => {
    const blobs: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      value: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:mock'
      },
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
    const anchors: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this)
    })

    let release: (() => void) | undefined
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [backup({ id: 'bk_a', created_at: atToday(2, 0) })], running: null })),
      http.get(`${BACKUPS_URL}/bk_a/download`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return new HttpResponse('{"t":"manifest"}\n', { headers: { 'content-type': 'application/x-ndjson' } })
      }),
    )
    await renderConnected()

    fireEvent.click(await screen.findByRole('button', { name: '↓' }))
    expect(await screen.findByRole('button', { name: 'downloading…' })).toBeDisabled()

    release?.()
    await waitFor(() => expect(anchors[0]?.download).toBe('bk_a.ndjson'))
    expect(blobs).toHaveLength(1)
  })

  it('deletes only after the inline confirmation', async () => {
    let deleted = 0
    let listCalls = 0
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => {
        listCalls += 1
        return HttpResponse.json({ backups: deleted === 0 ? [backup({ id: 'bk_a', created_at: atToday(2, 0) })] : [], running: null })
      }),
      http.delete(`${BACKUPS_URL}/bk_a`, () => {
        deleted += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await renderConnected()

    fireEvent.click(await screen.findByTitle('delete backup'))
    expect(deleted).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }))

    expect(await screen.findByText('no backups yet')).toBeInTheDocument()
    expect(deleted).toBe(1)
    expect(listCalls).toBe(2)
  })

  it('shows the server text and refreshes the list when the archive is already gone (404)', async () => {
    let listCalls = 0
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => {
        listCalls += 1
        return HttpResponse.json({ backups: [backup({ id: 'bk_a', created_at: atToday(2, 0) })], running: null })
      }),
      http.delete(`${BACKUPS_URL}/bk_a`, () => HttpResponse.text('404 Not Found: backup not found', { status: 404 })),
    )
    await renderConnected()

    fireEvent.click(await screen.findByTitle('delete backup'))
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }))

    expect(await screen.findByText('404 Not Found: backup not found')).toBeInTheDocument()
    await waitFor(() => expect(listCalls).toBe(2))
  })

  it('disables restore on an incomplete archive', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () =>
        HttpResponse.json({ backups: [backup({ id: 'bk_a', state: 'incomplete', created_at: atToday(2, 0) })], running: null }),
      ),
    )
    await renderConnected()

    const restore = await screen.findByRole('button', { name: 'restore' })
    expect(restore).toBeDisabled()
    expect(restore).toHaveAttribute('title', 'incomplete archive — cannot restore')
  })
})

describe('BackupsCard upload', () => {
  it('uploads the raw archive and refreshes the list on 201', async () => {
    let uploaded: string | undefined
    let listCalls = 0
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => {
        listCalls += 1
        return HttpResponse.json({ backups: [], running: null })
      }),
      http.post(`${BACKUPS_URL}/upload`, async ({ request }) => {
        uploaded = await request.text()
        return HttpResponse.json({ id: 'bk_up', state: 'complete', scope: 'all' }, { status: 201 })
      }),
    )
    await renderConnected()
    await screen.findByText('no backups yet')

    const file = new File(['{"t":"manifest"}\n'], 'archive.ndjson', { type: 'application/x-ndjson' })
    fireEvent.change(screen.getByLabelText('upload archive'), { target: { files: [file] } })

    await waitFor(() => expect(uploaded).toBe('{"t":"manifest"}\n'))
    await waitFor(() => expect(listCalls).toBe(2))
  })

  it('shows the 400 invalid_backup_file text inline', async () => {
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.post(`${BACKUPS_URL}/upload`, () => HttpResponse.text('400 Bad Request: invalid_backup_file', { status: 400 })),
    )
    await renderConnected()
    await screen.findByText('no backups yet')

    const file = new File(['nope'], 'archive.ndjson', { type: 'application/x-ndjson' })
    fireEvent.change(screen.getByLabelText('upload archive'), { target: { files: [file] } })

    expect(await screen.findByText('400 Bad Request: invalid_backup_file')).toBeInTheDocument()
  })
})

describe('BackupsCard restore row', () => {
  function seedRestore(includeAuth = false): void {
    noteRestoreStarted({ restore_id: 'rst_1', backup_id: 'bk_a', startedAt: Date.now(), include_auth: includeAuth, connectionId: 'conn-1' })
  }

  function restoreHandlers(state: string) {
    return [
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [backup({ id: 'bk_a', created_at: atToday(2, 0) })], running: null })),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () =>
        HttpResponse.json({
          restore_id: 'rst_1',
          backup_id: 'bk_a',
          state,
          imported: 4,
          skipped: 0,
          failed: 0,
          errors: [],
          started_at: 1,
        }),
      ),
    ]
  }

  it('blocks the job actions while the registry restore is running', async () => {
    seedRestore()
    server.use(...restoreHandlers('running'))
    await renderConnected()

    expect(await screen.findByText('restore · running')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'restore' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '▶ run backup now' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '×' })).not.toBeInTheDocument()
  })

  it('treats a failing status query as unavailable, keeps actions usable and offers dismiss', async () => {
    seedRestore()
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [backup({ id: 'bk_a', created_at: atToday(2, 0) })], running: null })),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () => HttpResponse.text('500 Internal Server Error: boom', { status: 500 })),
    )
    await renderConnected()

    expect(await screen.findByText('restore · status unavailable')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'restore' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '▶ run backup now' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '×' }))
    await waitFor(() => expect(screen.queryByText('restore · status unavailable')).not.toBeInTheDocument())
  })

  it('ignores a registry entry that belongs to another connection', async () => {
    noteRestoreStarted({ restore_id: 'rst_9', backup_id: 'bk_a', startedAt: Date.now(), include_auth: false, connectionId: 'other-conn' })
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
    )
    await renderConnected()

    expect(await screen.findByText('no backups yet')).toBeInTheDocument()
    expect(screen.queryByText(/restore ·/)).not.toBeInTheDocument()
  })

  it('offers view + dismiss on a finished restore and invalidates the domain lists once', async () => {
    seedRestore()
    server.use(...restoreHandlers('complete'))
    const queryClient = await renderConnected()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    expect(await screen.findByText('restore · complete')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['domains', 'kv'] }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['domains', 'json'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['domains', 'rel'] })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['auth', 'users'] })

    fireEvent.click(screen.getByRole('button', { name: '×' }))
    await waitFor(() => expect(screen.queryByText('restore · complete')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '▶ run backup now' })).toBeEnabled()
  })

  it('also invalidates users and the capability probe when the restore carried auth records', async () => {
    seedRestore(true)
    server.use(...restoreHandlers('failed'))
    const queryClient = await renderConnected()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    expect(await screen.findByText('restore · failed')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['auth', 'users'] }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['capabilities', 'admin-probe'] })
  })

  it('reports a lost status after a server restart and still invalidates the domain lists', async () => {
    seedRestore()
    server.use(
      ...baseHandlers(),
      http.get(BACKUPS_URL, () => HttpResponse.json({ backups: [], running: null })),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () => HttpResponse.text('404 Not Found: restore not found', { status: 404 })),
    )
    const queryClient = await renderConnected()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    expect(await screen.findByText('restore · status lost')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['domains', 'kv'] }))
    expect(screen.getByRole('button', { name: '▶ run backup now' })).toBeEnabled()
  })
})
