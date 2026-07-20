import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { record } from '../../api'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { noteReindexStart, resetReindexTasks } from '../../lib'
import { useSelectedDomain } from '../../shell'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { server } from '../../test/msw'
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

const METRICS = {
  system: { total_reads: 8, total_writes: 19, compaction_runs: 3, janitor_runs: 5, memtable_size_bytes: 1000 },
  domains: [],
  block_cache: {},
}

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function baseHandlers() {
  return [
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
    http.get(`${ORIGIN}/store-api/domains`, () =>
      HttpResponse.json([
        { name: 'shop', created_at: 1 },
        { name: 'sessions', created_at: 2 },
      ]),
    ),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1, state: 'active' }])),
    http.get(`${ORIGIN}/health`, () => HttpResponse.json(HEALTH)),
    http.get(`${ORIGIN}/store-api/metrics`, () => HttpResponse.json(METRICS)),
    http.get(`${ORIGIN}/store-api/json/domains/shop`, () =>
      HttpResponse.json({ name: 'shop', created_at: 1, state: 'active', document_count: 42 }),
    ),
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

async function connectAndRender(initialPath = '/engines') {
  server.use(...baseHandlers())
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

    expect(await screen.findByText('no client-started tasks · reindex can be triggered via REST explorer')).toBeInTheDocument()
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

  it('renders the SYSTEM throughput bar wired to /store-api/metrics (delta-integration itself covered by SystemThroughput.test.tsx)', async () => {
    await connectAndRender()

    const throughputText = () => document.querySelector('.engines__throughput')?.textContent ?? ''
    expect(await screen.findByText('system-wide · derived from /store-api/metrics')).toBeInTheDocument()
    // Nur ein Metrik-Stand bislang ⇒ noch keine Rate (spec §1: Rate braucht zwei Metrik-Stände).
    expect(throughputText()).toContain('0 reads/s')
    expect(throughputText()).toContain('0 writes/s')
    expect(document.querySelectorAll('.engines__spark-bar')).toHaveLength(24) // 2 Sparklines à 12 Balken
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
