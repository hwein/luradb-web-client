import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { clearRestoreEntry, type BackupDetail } from './backups'
import { RestoreForm } from './RestoreModal'

const ORIGIN = window.location.origin
const DETAIL_URL = `${ORIGIN}/store-api/backups/bk_a`

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function ConnectedForm({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <RestoreForm apiClient={apiClient} backupId="bk_a" onClose={onClose} />
}

function versionHandler() {
  return http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' }))
}

function detailHandler(detail: BackupDetail) {
  return http.get(DETAIL_URL, () => HttpResponse.json(detail))
}

async function renderForm(onClose: () => void = () => {}) {
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConnectedForm onClose={onClose} />
    </QueryClientProvider>,
  )
  return { queryClient, view }
}

beforeEach(() => clearRestoreEntry())

afterEach(() => {
  act(() => disconnect())
})

describe('RestoreForm archive facts', () => {
  it('renders "—" for missing/null manifest fields', async () => {
    server.use(versionHandler(), detailHandler({ id: 'bk_a', state: 'complete', scope: 'kv:shop', size_bytes: null, schedule: null }))
    await renderForm()

    expect(await screen.findByText('kv:shop')).toBeInTheDocument()
    const values = [...document.querySelectorAll('.rsm__fact-value')].map((node) => node.textContent)
    expect(values).toEqual(['kv:shop', '—', '—', '—', '—', '—'])
  })

  it('shows format, shards, lsn cut and rel snapshot of a format version 3 archive', async () => {
    server.use(
      versionHandler(),
      detailHandler({
        id: 'bk_a',
        state: 'complete',
        scope: 'rel:orders',
        created_at: 1,
        size_bytes: 10,
        format_version: 3,
        shards: 4,
        lsn_cut: { kv: 0, json: 0, rel: 4410 },
        rel_snapshot_ts: 88213,
        include_auth: false,
        schedule: null,
      }),
    )
    await renderForm()

    await screen.findByText('rel:orders')
    const labels = [...document.querySelectorAll('.rsm__fact-label')].map((node) => node.textContent)
    expect(labels).toEqual(['scope', 'created', 'size', 'format', 'lsn cut', 'rel snapshot', 'include auth', 'schedule'])
    const values = [...document.querySelectorAll('.rsm__fact-value')].map((node) => node.textContent)
    expect(values[3]).toBe('v3 · shards 4')
    expect(values[4]).toBe('kv 0 · json 0 · rel 4,410')
    expect(values[5]).toBe('88,213')
  })

  it('shows a format version 1 archive without shards, lsn cut and rel snapshot', async () => {
    server.use(
      versionHandler(),
      detailHandler({
        id: 'bk_a',
        state: 'complete',
        scope: 'kv:shop',
        created_at: 1,
        size_bytes: 10,
        format_version: 1,
        shards: 0,
        lsn_cut: null,
        rel_snapshot_ts: 0,
        include_auth: false,
        schedule: null,
      }),
    )
    await renderForm()

    await screen.findByText('kv:shop')
    const labels = [...document.querySelectorAll('.rsm__fact-label')].map((node) => node.textContent)
    expect(labels).toEqual(['scope', 'created', 'size', 'format', 'include auth', 'schedule'])
    expect(document.querySelectorAll('.rsm__fact-value')[3]?.textContent).toBe('v1')
  })

  it('shows a hint and invalidates the list when the archive is gone', async () => {
    server.use(versionHandler(), http.get(DETAIL_URL, () => HttpResponse.text('404 Not Found: backup not found', { status: 404 })))
    const { queryClient } = await renderForm()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    expect(await screen.findByText('backup archive is gone — it was deleted on the server')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['backups', 'list'] }))
    expect(screen.queryByRole('button', { name: 'restore' })).not.toBeInTheDocument()
  })
})

describe('RestoreForm options', () => {
  it('offers "into domain" for a single-domain archive and keeps the auth checkbox usable when include_auth is null', async () => {
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'json:logs', created_at: 1, size_bytes: 10, format_version: 1, include_auth: null }),
    )
    await renderForm()

    expect(await screen.findByLabelText('into domain')).toBeInTheDocument()
    expect(screen.getByLabelText('apply auth records')).toBeEnabled()
    expect(screen.queryByText(/whole-engine restores usually need replace/)).not.toBeInTheDocument()
  })

  it('hides "into domain" for a whole-engine archive, shows the default-domain hint and locks auth when the archive has none', async () => {
    server.use(versionHandler(), detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1, include_auth: false }))
    await renderForm()

    expect(await screen.findByText(/whole-engine restores usually need replace/)).toBeInTheDocument()
    expect(screen.queryByLabelText('into domain')).not.toBeInTheDocument()
    expect(screen.getByLabelText('apply auth records')).toBeDisabled()
  })

  it('warns permanently in replace mode and arms the submit before sending', async () => {
    const bodies: unknown[] = []
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ restore_id: 'rst_1', state: 'running' }, { status: 202 })
      }),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () =>
        HttpResponse.json({ restore_id: 'rst_1', backup_id: 'bk_a', state: 'running', imported: 0, skipped: 0, failed: 0, errors: [], started_at: 1 }),
      ),
    )
    await renderForm()

    fireEvent.click(await screen.findByLabelText('replace'))
    expect(screen.getByText('replace overwrites the engines the archive holds — the domain and its permissions stay')).toBeInTheDocument()
    expect(screen.queryByText(/whole-engine restores usually need replace/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'restore' }))
    expect(bodies).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'confirm replace' }))

    await waitFor(() => expect(bodies).toEqual([{ mode: 'replace' }]))
  })

  it('sends into_domain and include_auth when both are set, and warns about the own key', async () => {
    const bodies: unknown[] = []
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'kv:shop', created_at: 1, include_auth: true }),
      http.post(`${DETAIL_URL}/restore`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ restore_id: 'rst_1', state: 'running' }, { status: 202 })
      }),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () =>
        HttpResponse.json({ restore_id: 'rst_1', backup_id: 'bk_a', state: 'running', imported: 0, skipped: 0, failed: 0, errors: [], started_at: 1 }),
      ),
    )
    await renderForm()

    fireEvent.change(await screen.findByLabelText('into domain'), { target: { value: 'shop copy' } })
    expect(screen.getByRole('button', { name: 'restore' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('into domain'), { target: { value: 'shop-copy' } })
    fireEvent.click(screen.getByLabelText('apply auth records'))
    expect(screen.getByText('may replace users and keys — your own key can change (reconnect required)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'restore' }))
    await waitFor(() => expect(bodies).toEqual([{ mode: 'fail_if_exists', into_domain: 'shop-copy', include_auth: true }]))
  })

  it('offers into domain for a rel:<domain> archive and sends into_domain', async () => {
    const bodies: unknown[] = []
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'rel:orders', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ restore_id: 'rst_1', state: 'running' }, { status: 202 })
      }),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () =>
        HttpResponse.json({ restore_id: 'rst_1', backup_id: 'bk_a', state: 'running', imported: 0, skipped: 0, failed: 0, errors: [], started_at: 1 }),
      ),
    )
    await renderForm()

    fireEvent.change(await screen.findByLabelText('into domain'), { target: { value: 'orders-copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'restore' }))

    await waitFor(() => expect(bodies).toEqual([{ mode: 'fail_if_exists', into_domain: 'orders-copy' }]))
  })

  it('explains the link remap for rel and domain archives only', async () => {
    const hint = 'a new name also repoints KVREF/JSONREF links of relational tables to the KV and JSON domain of that name'
    for (const [scope, explained] of [
      ['rel:orders', true],
      ['domain:shop', true],
      ['kv:shop', false],
      ['json:logs', false],
    ] as const) {
      server.use(versionHandler(), detailHandler({ id: 'bk_a', state: 'complete', scope, created_at: 1 }))
      const { view } = await renderForm()

      const field = (await screen.findByLabelText('into domain')).parentElement
      const found = field?.querySelector('.rsm__hint')
      if (explained) expect(found?.textContent).toBe(hint)
      else expect(screen.queryByText(hint)).not.toBeInTheDocument()

      view.unmount()
    }
  })

  it('appends the retry delay when the restore start fails with 503 and Retry-After', async () => {
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, () =>
        HttpResponse.text('503 Service Unavailable: the server is overloaded, retry later', { status: 503, headers: { 'Retry-After': '1' } }),
      ),
    )
    await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))

    await waitFor(() =>
      expect(document.querySelector('.rsm__danger')?.textContent).toBe('503 Service Unavailable: the server is overloaded, retry later · retry in 1 s'),
    )
    expect(screen.getByRole('button', { name: 'restore' })).toBeInTheDocument()
  })

  it('shows a 507 on restore start once, with the retry delay the server names', async () => {
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, () =>
        HttpResponse.text('507 Insufficient Storage: write blocked: disk space below threshold, retry in 5 s', {
          status: 507,
          headers: { 'Retry-After': '5' },
        }),
      ),
    )
    await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))

    await waitFor(() =>
      expect(document.querySelector('.rsm__danger')?.textContent).toBe('507 Insufficient Storage: write blocked: disk space below threshold, retry in 5 s'),
    )
    expect(screen.getByRole('button', { name: 'restore' })).toBeInTheDocument()
  })

  it('shows a synchronous 409 backup_busy as form error', async () => {
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, () => HttpResponse.text('409 Conflict: backup_busy', { status: 409 })),
    )
    await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))

    expect(await screen.findByText('409 Conflict: backup_busy')).toBeInTheDocument()
  })
})

describe('RestoreForm status view', () => {
  function startHandlers(status: Record<string, unknown>) {
    return [
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, () => HttpResponse.json({ restore_id: 'rst_1', state: 'running' }, { status: 202 })),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () => HttpResponse.json(status)),
    ]
  }

  it('switches to the live status and reports the counts on complete', async () => {
    server.use(
      ...startHandlers({ restore_id: 'rst_1', backup_id: 'bk_a', state: 'complete', imported: 12, skipped: 3, failed: 0, errors: [], started_at: 1 }),
    )
    await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))

    expect(await screen.findByText('restore · complete')).toBeInTheDocument()
    expect(screen.getByText(/imported 12 · skipped 3/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'restore' })).not.toBeInTheDocument()
  })

  it('lists the async errors of a failed restore', async () => {
    server.use(
      ...startHandlers({
        restore_id: 'rst_1',
        backup_id: 'bk_a',
        state: 'failed',
        imported: 0,
        skipped: 0,
        failed: 1,
        errors: [{ key: '_restore_', error: 'domain_exists: default' }],
        started_at: 1,
      }),
    )
    await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))

    expect(await screen.findByText('restore · failed')).toBeInTheDocument()
    expect(screen.getByText('_restore_ · domain_exists: default')).toBeInTheDocument()
  })

  it('reports a lost status when the restore id is unknown after a server restart', async () => {
    server.use(
      versionHandler(),
      detailHandler({ id: 'bk_a', state: 'complete', scope: 'all', created_at: 1 }),
      http.post(`${DETAIL_URL}/restore`, () => HttpResponse.json({ restore_id: 'rst_1', state: 'running' }, { status: 202 })),
      http.get(`${ORIGIN}/store-api/restores/rst_1`, () => HttpResponse.text('404 Not Found: restore not found', { status: 404 })),
    )
    await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))

    expect(await screen.findByText('restore status lost (server restarted) — check the domain list')).toBeInTheDocument()
  })

  it('keeps the registry entry across close and remount', async () => {
    server.use(
      ...startHandlers({ restore_id: 'rst_1', backup_id: 'bk_a', state: 'complete', imported: 1, skipped: 0, failed: 0, errors: [], started_at: 1 }),
    )
    const { view } = await renderForm()

    fireEvent.click(await screen.findByRole('button', { name: 'restore' }))
    await screen.findByText('restore · complete')
    expect(sessionStorage.getItem('luradb.restore')).toContain('rst_1')

    view.unmount()
    await renderForm()

    expect(await screen.findByText('restore · complete')).toBeInTheDocument()
  })
})
