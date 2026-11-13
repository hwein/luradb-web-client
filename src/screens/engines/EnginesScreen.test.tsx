import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { record } from '../../api'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { noteReindexStart, resetReindexTasks } from '../../lib'
import { useSelectedDomain } from '../../shell'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { domainResponse, server } from '../../test/msw'
import { resetDocsState, useDocsState } from '../docs/docsStore'
import { EnginesScreen } from './EnginesScreen'

const ORIGIN = window.location.origin

const HEALTH = {
  status: 'ok',
  uptime_secs: 100,
  version: '0.1.0',
  domain_count: 2,
  estimated_memtable_keys: 24,
  l0_sstable_count: 1,
  vlog_size_bytes: 2097152, // 2.0 MB
}

function engineBlock(fields: Record<string, number>) {
  return {
    read_ops: 0,
    write_ops: 0,
    window_secs: 60,
    read_latency_us_p50: 0,
    read_latency_us_p95: 0,
    read_latency_us_p99: 0,
    write_latency_us_p50: 0,
    write_latency_us_p95: 0,
    write_latency_us_p99: 0,
    ...fields,
  }
}

const METRICS = {
  system: { total_reads: 8, total_writes: 19, compaction_runs: 3, janitor_runs: 5, memtable_size_bytes: 1000 },
  engines: {
    kv: engineBlock({ read_ops: 100, write_ops: 200, read_latency_us_p50: 5, read_latency_us_p95: 50, write_latency_us_p50: 500, write_latency_us_p95: 5000 }),
    json: engineBlock({ read_ops: 60, write_ops: 0, read_latency_us_p50: 7, read_latency_us_p95: 70 }),
    rel: engineBlock({}),
  },
  domains: [],
  block_cache: {},
}

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function baseHandlers() {
  return [
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse('shop'), domainResponse('sessions', { created_at: 2 })])),
    http.get(`${ORIGIN}/store-api/auth/whoami`, () => HttpResponse.json({ name: 'admin', role: 'Admin' })),
    http.get(`${ORIGIN}/health`, () => HttpResponse.json(HEALTH)),
    http.get(`${ORIGIN}/store-api/metrics`, () => HttpResponse.json(METRICS)),
    http.get(`${ORIGIN}/store-api/json/shop/documents/count`, () => HttpResponse.json({ count: 42 })),
    http.get(`${ORIGIN}/store-api/json/shop/indexes`, () =>
      HttpResponse.json([
        { created_at: 1, field: 'city', type: 'string' },
        { created_at: 2, field: 'email', type: 'string' },
      ]),
    ),
    http.get(`${ORIGIN}/store-api/rel/shop/tables`, () =>
      HttpResponse.json([
        { name: 'orders', _links: { self: '', rows: '' } },
        { name: 'order_items', _links: { self: '', rows: '' } },
      ]),
    ),
    http.get(`${ORIGIN}/store-api/rel/shop/views`, () => HttpResponse.json([{ name: 'v_paid', created_at: 1, sql: 'SELECT 1' }])),
    http.get(`${ORIGIN}/store-api/json/sessions/documents/count`, () => HttpResponse.json({ count: 0 })),
    http.get(`${ORIGIN}/store-api/json/sessions/indexes`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/sessions/tables`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/sessions/views`, () => HttpResponse.json([])),
  ]
}

function DocsRouteProbe() {
  const docs = useDocsState()
  return <p data-testid="docs-screen">docs: {docs.activeId ?? ''}</p>
}

function DataRouteProbe() {
  const { selected } = useSelectedDomain()
  const location = useLocation()
  return (
    <p data-testid="data-probe">
      {selected ?? ''} {location.search}
    </p>
  )
}

async function connectAndRender(initialPath = '/engines', extraHandlers: RequestHandler[] = []) {
  server.use(...baseHandlers())
  // Zweiter `.use()`-Aufruf (statt gemeinsam mit baseHandlers()): MSW priorisiert den zuletzt registrierten
  // Handler je Route — so überschreiben testspezifische Routen die Defaults zuverlässig vor dem ersten Fetch.
  if (extraHandlers.length > 0) server.use(...extraHandlers)
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SelectedDomainProvider>
          <Routes>
            <Route path="/engines" element={<EnginesScreen />} />
            <Route path="/data" element={<DataRouteProbe />} />
            <Route path="/docs" element={<DocsRouteProbe />} />
          </Routes>
        </SelectedDomainProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function cardText(tone: 'kv' | 'json' | 'rel'): string {
  return document.querySelector(`.engines__card--${tone}`)?.textContent ?? ''
}

afterEach(() => {
  act(() => disconnect())
  resetReindexTasks()
  resetDocsState()
})

describe('EnginesScreen', () => {
  it('renders engine card metrics from health/metrics/domain-detail queries, with isSuccess status dots and open-in domain links', async () => {
    await connectAndRender()

    await waitFor(() => expect(cardText('kv')).toContain('2.0 MB'))
    expect(cardText('kv')).toContain('domains')
    expect(cardText('kv')).toContain('2')
    expect(cardText('kv')).toContain('memtable keys (est.)')
    expect(cardText('kv')).toContain('24')
    expect(cardText('kv')).toContain('L0 sstables')
    expect(cardText('kv')).toContain('vlog size')
    expect(cardText('kv')).toContain('open in:')
    expect(cardText('kv')).toContain('shop')
    expect(cardText('kv')).toContain('sessions')
    expect(document.querySelector('.engines__card--kv .engines__dot--ok')).toBeInTheDocument()

    await waitFor(() => expect(cardText('json')).toContain('42'))
    expect(cardText('json')).toContain('documents')
    expect(cardText('json')).toContain('indexes')
    expect(cardText('json')).toContain('2')
    expect(document.querySelector('.engines__card--json .engines__dot--ok')).toBeInTheDocument()

    await waitFor(() => expect(cardText('rel')).toContain('views'))
    expect(cardText('rel')).toContain('tables')
    expect(cardText('rel')).toContain('2')
    expect(cardText('rel')).toContain('1')
    expect(document.querySelector('.engines__card--rel .engines__dot--ok')).toBeInTheDocument()
  })

  it('turns the status dot of an engine off when its endpoints answer 503', async () => {
    await connectAndRender('/engines', [
      http.get(`${ORIGIN}/store-api/json/:domain/documents/count`, () => HttpResponse.text('JSON engine disabled', { status: 503 })),
      http.get(`${ORIGIN}/store-api/json/:domain/indexes`, () => HttpResponse.text('JSON engine disabled', { status: 503 })),
      http.get(`${ORIGIN}/store-api/rel/:domain/tables`, () => HttpResponse.text('Relational engine disabled', { status: 503 })),
      http.get(`${ORIGIN}/store-api/rel/:domain/views`, () => HttpResponse.text('Relational engine disabled', { status: 503 })),
    ])

    // the kv dot is on once the domain list has loaded; from then on a json/rel dot goes off only through the 503
    await waitFor(() => expect(document.querySelector('.engines__card--kv .engines__dot--ok')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('.engines__card--json .engines__dot--ok')).not.toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('.engines__card--rel .engines__dot--ok')).not.toBeInTheDocument())
    expect(document.querySelector('.engines__card--kv .engines__dot--ok')).toBeInTheDocument()
  })

  it('"open in: <domain>" selects the domain and navigates into the matching data-browser engine mode', async () => {
    await connectAndRender()
    await waitFor(() => expect(cardText('json')).toContain('42'))

    const kvCard = document.querySelector('.engines__card--kv') as HTMLElement
    fireEvent.click(within(kvCard).getByRole('button', { name: 'shop' }))

    const probe = await screen.findByTestId('data-probe')
    await waitFor(() => expect(probe.textContent).toContain('shop'))
    expect(probe.textContent).toContain('engine=kv')
  })

  it('shows the empty tasks state and the compaction/janitor counters from /store-api/metrics.system', async () => {
    await connectAndRender()

    expect(await screen.findByText('no client-started tasks')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.engines__tasks')?.textContent).toContain('compaction runs'))
    expect(document.querySelector('.engines__tasks')?.textContent).toContain('3')
    expect(document.querySelector('.engines__tasks')?.textContent).toContain('janitor runs')
    expect(document.querySelector('.engines__tasks')?.textContent).toContain('5')
  })

  it(
    'polls a client-started reindex task from running to completed, then stops showing a progress bar',
    async () => {
      let statusCalls = 0
      server.use(
        http.get(`${ORIGIN}/store-api/json/shop/reindex/task_abc123`, () => {
          statusCalls += 1
          return HttpResponse.json(
            statusCalls === 1 ? { state: 'running', processed: 2, total_estimated: 10 } : { state: 'completed', processed: 10, duration_secs: 3 },
          )
        }),
      )
      await connectAndRender()
      act(() => noteReindexStart('/store-api/json/shop/reindex', { task_id: 'task_abc123' }))

      expect(await screen.findByText('reindex shop')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByText(/running · 20% · task_abc/)).toBeInTheDocument())
      expect(document.querySelector('.engines__task-bar')).toBeInTheDocument()

      await waitFor(() => expect(screen.getByText(/completed · 10 docs · 3s/)).toBeInTheDocument(), { timeout: 6000 })
      expect(document.querySelector('.engines__task-bar')).not.toBeInTheDocument()
    },
    8000,
  )

  describe('reindex trigger (spec engines/002)', () => {
    it('disables the reindex trigger with a reason when there are no domains', async () => {
      await connectAndRender('/engines', [http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([]))])

      const toggle = await screen.findByRole('button', { name: '▶ reindex…' })
      await waitFor(() => expect(toggle).toBeDisabled())
      expect(toggle).toHaveAttribute('title', 'no domains to reindex')
    })

    it('offers every domain of the domain list in the domain dropdown and sources fields from the shared index cache', async () => {
      await connectAndRender()

      const toggle = await screen.findByRole('button', { name: '▶ reindex…' })
      await waitFor(() => expect(toggle).toBeEnabled())
      fireEvent.click(toggle)

      const domainSelect = await screen.findByLabelText('reindex domain')
      expect(within(domainSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['shop', 'sessions'])

      const fieldSelect = screen.getByLabelText('reindex field')
      await waitFor(() =>
        expect(within(fieldSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['all indexes', 'city', 'email']),
      )
    })

    it('202: closes the form, shows the task as a running row immediately, and records the POST call', async () => {
      let requestBody: unknown
      server.use(
        http.post(`${ORIGIN}/store-api/json/shop/reindex`, async ({ request }) => {
          requestBody = await request.json()
          return HttpResponse.json({ task_id: 'task_xyz789' }, { status: 202 })
        }),
        // Registrierung startet sofort den 2s-Status-Poll (engines/001) — mocken, sonst ginge der Request
        // unhandled auf das echte Netzwerk (hängt, verhungert den Connection-Pool nachfolgender Tests).
        http.get(`${ORIGIN}/store-api/json/shop/reindex/task_xyz789`, () => HttpResponse.json({ state: 'running', processed: 0, total_estimated: 0 })),
      )
      await connectAndRender()

      const toggle = await screen.findByRole('button', { name: '▶ reindex…' })
      await waitFor(() => expect(toggle).toBeEnabled())
      fireEvent.click(toggle)
      fireEvent.click(await screen.findByRole('button', { name: 'start reindex' }))

      expect(await screen.findByText('reindex shop')).toBeInTheDocument()
      expect(screen.queryByLabelText('reindex domain')).not.toBeInTheDocument()
      expect(requestBody).toEqual({}) // "all indexes" default ⇒ field weggelassen

      expect(document.querySelector('.engines__requests')?.textContent).toContain('/store-api/json/shop/reindex')
    })

    it('sends the chosen field instead of the "all indexes" default', async () => {
      let requestBody: unknown
      server.use(
        http.post(`${ORIGIN}/store-api/json/shop/reindex`, async ({ request }) => {
          requestBody = await request.json()
          return HttpResponse.json({ task_id: 'task_field1' }, { status: 202 })
        }),
        http.get(`${ORIGIN}/store-api/json/shop/reindex/task_field1`, () => HttpResponse.json({ state: 'running', processed: 0, total_estimated: 0 })),
      )
      await connectAndRender()

      const toggle = await screen.findByRole('button', { name: '▶ reindex…' })
      await waitFor(() => expect(toggle).toBeEnabled())
      fireEvent.click(toggle)
      const fieldSelect = await screen.findByLabelText('reindex field')
      await waitFor(() => expect(within(fieldSelect).getAllByRole('option')).toHaveLength(3))
      fireEvent.change(fieldSelect, { target: { value: 'email' } })
      fireEvent.click(screen.getByRole('button', { name: 'start reindex' }))

      await waitFor(() => expect(requestBody).toEqual({ field: 'email' }))
    })

    it('409: shows the original server message inline and leaves the task registry untouched', async () => {
      server.use(
        http.post(`${ORIGIN}/store-api/json/shop/reindex`, () =>
          HttpResponse.text("re-index already running for domain 'shop' (task 61ec3e5f)", { status: 409 }),
        ),
      )
      await connectAndRender()

      const toggle = await screen.findByRole('button', { name: '▶ reindex…' })
      await waitFor(() => expect(toggle).toBeEnabled())
      fireEvent.click(toggle)
      fireEvent.click(await screen.findByRole('button', { name: 'start reindex' }))

      expect(await screen.findByText("re-index already running for domain 'shop' (task 61ec3e5f)")).toBeInTheDocument()
      expect(screen.getByLabelText('reindex domain')).toBeInTheDocument() // Formular bleibt offen
      expect(screen.getByText('no client-started tasks')).toBeInTheDocument() // Registry unverändert
    })
  })

  it('shows per-engine ops/s and latency lines from the engines block', async () => {
    await connectAndRender()

    const kvCard = document.querySelector('.engines__card--kv') as HTMLElement
    await waitFor(() => expect(kvCard.querySelector('.engines__card-ops')?.textContent).toContain('5.0'))
    expect(kvCard.querySelector('.engines__card-window')?.textContent).toBe('60s window')
    expect(Array.from(kvCard.querySelectorAll('.engines__card-lat')).map((line) => line.textContent)).toEqual([
      'reads 1.7/s · p50 5 µs · p95 50 µs',
      'writes 3.3/s · p50 500 µs · p95 5.0 ms',
    ])
    expect(document.querySelectorAll('.engines__spark-bar')).toHaveLength(36)
  })

  it('shows the json and rel cards with their own figures', async () => {
    await connectAndRender()

    const jsonCard = document.querySelector('.engines__card--json') as HTMLElement
    const relCard = document.querySelector('.engines__card--rel') as HTMLElement
    const latLines = (card: HTMLElement) => Array.from(card.querySelectorAll('.engines__card-lat')).map((line) => line.textContent)
    await waitFor(() => expect(jsonCard.querySelector('.engines__card-ops')?.textContent).toBe('1.0 ops/s'))
    expect(latLines(jsonCard)).toEqual(['reads 1.0/s · p50 7 µs · p95 70 µs', 'writes 0/s'])
    expect(relCard.querySelector('.engines__card-ops')?.textContent).toBe('0 ops/s')
    expect(latLines(relCard)).toEqual(['reads 0/s', 'writes 0/s'])
  })

  it('never renders the system-wide throughput label', async () => {
    await connectAndRender()

    await waitFor(() => expect(document.querySelector('.engines__card-window')).toBeInTheDocument())
    expect(screen.queryByText('system-wide · derived from /store-api/metrics')).not.toBeInTheDocument()
  })

  describe('health bar (spec s-c5d388f5)', () => {
    const HEALTH_DEGRADED = {
      ...HEALTH,
      status: 'degraded',
      shards: [
        { id: 0, status: 'ok' },
        { id: 1, status: 'timeout' },
      ],
      resources: { state: 'warning', disk_state: 'blocked', memory_state: 'warning' },
      io: { failures: 2 },
    }
    const barText = () => document.querySelector('.engines__health')?.textContent ?? ''

    it('shows the health bar', async () => {
      await connectAndRender('/engines', [http.get(`${ORIGIN}/health`, () => HttpResponse.json(HEALTH_DEGRADED, { status: 503 }))])

      await waitFor(() => expect(barText()).toContain('shards 1/2 ok'))
      expect(barText()).toContain('disk blocked')
      expect(barText()).toContain('memory warning')
      expect(barText()).toContain('i/o 2 failures')
      expect(screen.getByText('shards 1/2 ok')).toHaveAttribute('title', 'shard 0: ok\nshard 1: timeout')
      expect(screen.getByText('disk blocked')).toHaveClass('engines__health-seg--err')
      expect(screen.getByText('memory warning')).toHaveClass('engines__health-seg--warn')
    })

    it('appends admin numbers from metrics', async () => {
      await connectAndRender('/engines', [
        http.get(`${ORIGIN}/store-api/metrics`, () =>
          HttpResponse.json({
            ...METRICS,
            resources: {
              disk: [{ path: '/data', size_bytes: 2097152, free_bytes: 1048576, state: 'ok' }],
              memory: { rss_anon_bytes: 1048576, budget_bytes: 4194304, state: 'ok' },
            },
          }),
        ),
      ])

      await waitFor(() => expect(barText()).toContain('1.0 MB free of 2.0 MB'))
      expect(barText()).toContain('1.0 MB of 4.0 MB')
    })

    it('names titled segments by their visible text', async () => {
      await connectAndRender('/engines', [
        http.get(`${ORIGIN}/health`, () => HttpResponse.json(HEALTH_DEGRADED, { status: 503 })),
        http.get(`${ORIGIN}/store-api/metrics`, () =>
          HttpResponse.json({
            ...METRICS,
            resources: { disk: [{ path: '/data', size_bytes: 2097152, free_bytes: 1048576, state: 'ok' }] },
          }),
        ),
      ])

      const shardsSeg = await screen.findByRole('group', { name: 'shards 1/2 ok' })
      expect(shardsSeg).toHaveAttribute('title', 'shard 0: ok\nshard 1: timeout')
      const volumeSeg = await screen.findByRole('group', { name: '1.0 MB free of 2.0 MB' })
      expect(volumeSeg).toHaveAttribute('title', '/data')
    })

    it('shows metrics unavailable on 503', async () => {
      await connectAndRender('/engines', [
        http.get(`${ORIGIN}/store-api/metrics`, () => HttpResponse.text('503 Service Unavailable', { status: 503 })),
      ])

      await waitFor(() => expect(barText()).toContain('metrics unavailable'))
      expect(barText()).toContain('shards 0/0 ok')
      expect(barText()).not.toContain('free of')
      await waitFor(() => expect(cardText('kv')).toContain('2.0 MB'))
    })
  })

  it('renders recorder rows newest-first (max 20 visible), a why? link on a 409 row, and a distinct stream row', async () => {
    await connectAndRender()
    await waitFor(() => expect(cardText('kv')).toContain('2.0 MB'))

    act(() => {
      for (let i = 0; i < 25; i += 1) record({ method: 'GET', path: `/probe/${i}`, status: 200, ms: 1, ok: true })
      record({ method: 'PUT', path: '/store-api/json/shop/documents/cus_1', status: 409, ms: 4.2, ok: false })
      record({ method: 'GET', path: '/store-api/kv/shop/watch', status: 'stream', ms: 12, ok: true })
    })

    const rows = () => Array.from(document.querySelectorAll('.engines__request-row'))
    await waitFor(() => expect(rows()).toHaveLength(20))

    // Neueste zuerst: der zuletzt registrierte (stream) Call steht oben, danach der 409er.
    expect(rows()[0]?.textContent).toContain('kv/shop/watch')
    expect(rows()[0]?.textContent).toContain('stream')
    expect(rows()[1]?.textContent).toContain('cus_1')
    expect(rows()[1]?.textContent).toContain('409')

    const requestsText = document.querySelector('.engines__requests')?.textContent ?? ''
    expect(requestsText).toContain('/probe/24')
    expect(requestsText).not.toContain('/probe/0')

    fireEvent.click(screen.getByRole('button', { name: 'why?' }))
    expect(await screen.findByTestId('docs-screen')).toHaveTextContent('docs: errors-status-codes')
  })
})
