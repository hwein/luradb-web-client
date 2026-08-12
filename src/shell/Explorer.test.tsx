import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect } from '../app/session'
import { resetSqlState, useSqlState } from '../screens/sql/sqlStore'
import { server } from '../test/msw'
import { Explorer } from './Explorer'
import { SelectedDomainProvider } from './SelectedDomainContext'

interface RecordedQueryOptions {
  queryKey: readonly unknown[]
  refetchInterval?: number | false
}

const { useQuerySpy } = vi.hoisted(() => ({ useQuerySpy: vi.fn<(options: RecordedQueryOptions) => void>() }))

/** Records the options every `useQuery` call receives (spec shell/007 §7) — delegates to the real implementation unchanged. */
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: (options: RecordedQueryOptions) => {
      useQuerySpy(options)
      return (actual.useQuery as unknown as (options: RecordedQueryOptions) => unknown)(options)
    },
  }
})

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function domainListHandlers(kv: unknown[], json: unknown[], rel: unknown[]) {
  return [
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json(kv)),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json(json)),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json(rel)),
  ]
}

function relTablesHandler(domain: string, names: string[]) {
  return http.get(`${ORIGIN}/store-api/rel/${domain}/tables`, () =>
    HttpResponse.json(names.map((name) => ({ name, _links: { self: '', rows: '' } }))),
  )
}

function relViewsHandler(domain: string, names: string[]) {
  return http.get(`${ORIGIN}/store-api/rel/${domain}/views`, () =>
    HttpResponse.json(names.map((name) => ({ name, sql: 'SELECT 1', created_at: 1 }))),
  )
}

interface ColumnFixture {
  name: string
  type: string
}

function column(name: string, type: string): ColumnFixture & { nullable: boolean; primary_key: boolean; autoincrement: boolean; unique: boolean } {
  return { name, type, nullable: true, primary_key: false, autoincrement: false, unique: false }
}

function relTableDetailHandler(domain: string, table: string, columns: ReturnType<typeof column>[]) {
  return http.get(`${ORIGIN}/store-api/rel/${domain}/tables/${table}`, () =>
    HttpResponse.json({ name: table, columns, indexes: [], created_at: 1, _links: { self: '', rows: '' } }),
  )
}

function jsonDetailHandler(domain: string, documentCount: number) {
  return http.get(`${ORIGIN}/store-api/json/domains/${domain}`, () =>
    HttpResponse.json({ name: domain, created_at: 1, state: 'active', document_count: documentCount }),
  )
}

function jsonIndexesHandler(domain: string, count: number) {
  return http.get(`${ORIGIN}/store-api/json/${domain}/indexes`, () =>
    HttpResponse.json(Array.from({ length: count }, (_, index) => ({ field: `f${index}`, type: 'string', created_at: 1 }))),
  )
}

function kvKeysHandler(domain: string, keys: string[]) {
  return http.get(`${ORIGIN}/store-api/kv/${domain}/keys`, () => HttpResponse.json(keys))
}

/**
 * '▾ name' liegt seit spec shell/006 §1 auf einem Chevron-Span + einem Text-Node — RTL's Default-Textmatcher
 * sieht pro Element nur dessen direkte Text-Kinder, keine verschachtelten. Matcht daher gegen das volle
 * textContent, mit Kind-Ausschluss, damit nicht zusätzlich ein Vorfahre trifft (RTL-FAQ-Pattern).
 */
function expandedHeader(name: string): (content: string, element: Element | null) => boolean {
  const text = `▾ ${name}`
  return (_content, element) => {
    if (element === null || element.textContent !== text) return false
    return Array.from(element.children).every((child) => child.textContent !== text)
  }
}

function DataRouteProbe() {
  const location = useLocation()
  return (
    <p data-testid="data-route-state">
      {location.pathname}
      {location.search}
    </p>
  )
}

/** Liest den aktiven SQL-Tab direkt aus dem Store (sqlStore.ts) — kein Rendern der echten SqlScreen nötig. */
function SqlRouteProbe() {
  const location = useLocation()
  const { tabs, activeId } = useSqlState()
  const active = tabs.find((tab) => tab.id === activeId)
  return (
    <p data-testid="sql-route-state">
      {location.pathname} · {active?.text ?? ''}
    </p>
  )
}

async function connectAndRender() {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/sql']}>
        <SelectedDomainProvider>
          <Explorer />
        </SelectedDomainProvider>
        <Routes>
          <Route path="/data" element={<DataRouteProbe />} />
          <Route path="/sql" element={<SqlRouteProbe />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  act(() => disconnect())
  resetSqlState()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

describe('Explorer', () => {
  it('unions engines per domain: expands the alphabetically first domain, tags the collapsed ones', async () => {
    server.use(
      ...domainListHandlers(
        [
          { name: 'alpha', created_at: 1 },
          { name: 'beta', created_at: 1 },
          { name: 'gamma', created_at: 1 },
        ],
        [
          { name: 'alpha', created_at: 1, state: 'active' },
          { name: 'beta', created_at: 1, state: 'active' },
        ],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
      ),
      relTablesHandler('alpha', []),
      relViewsHandler('alpha', []),
      jsonDetailHandler('alpha', 0),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', []),
      // beta/gamma sind collapsed -> ihr Tag hängt an echter Aktivität, nicht an bloßer Registry-Zugehörigkeit.
      jsonDetailHandler('beta', 1),
      jsonIndexesHandler('beta', 0),
      kvKeysHandler('beta', ['b1']),
      kvKeysHandler('gamma', ['g1']),
    )

    await connectAndRender()

    expect(await screen.findByText(expandedHeader('alpha'))).toBeInTheDocument()
    expect(screen.getByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
    expect(screen.getByText('KEY-VALUE')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /▸ beta/ })).toBeInTheDocument()
    expect(await screen.findByText('json · kv')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /▸ gamma/ })).toBeInTheDocument()
    expect(await screen.findByText('kv')).toBeInTheDocument()
  })

  it('loads the sections of the expanded domain and switches expansion on click', async () => {
    server.use(
      ...domainListHandlers(
        [
          { name: 'alpha', created_at: 1 },
          { name: 'beta', created_at: 1 },
        ],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
      ),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', ['v_paid']),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      jsonDetailHandler('alpha', 3),
      jsonIndexesHandler('alpha', 1),
      kvKeysHandler('alpha', []),
      kvKeysHandler('beta', []),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /T orders/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /V v_paid/ })).toBeInTheDocument()
    expect(await screen.findByText('3 · idx 1')).toBeInTheDocument()
    // kv keys scan resolves empty -> only the label row's "+" action, no active row (spec shell/004 §4).
    expect(await screen.findByRole('button', { name: 'new key' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^K keys/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /▸ beta/ }))

    expect(await screen.findByText(expandedHeader('beta'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /▸ alpha/ })).toBeInTheDocument()
    expect(screen.queryByText('RELATIONAL')).not.toBeInTheDocument()
  })

  it('navigates to /data with the engine and table as query params on object-row clicks', async () => {
    server.use(
      ...domainListHandlers(
        [{ name: 'alpha', created_at: 1 }],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
      ),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      jsonDetailHandler('alpha', 1),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', ['k1', 'k2']),
    )

    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: /T orders/ }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=rel&table=orders')

    fireEvent.click(await screen.findByRole('button', { name: /^J documents/ }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=json')

    // aktiver kv-Store zeigt den echten Count aus dem Scan (spec shell/004 §4).
    const keysButton = await screen.findByRole('button', { name: /^K keys/ })
    expect(keysButton).toHaveTextContent('2')
    fireEvent.click(keysButton)
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=kv')
  })

  it('a view click opens the SQL console with a new LIMIT-50 select tab instead of the rel browser (no rows endpoint for views)', async () => {
    server.use(
      ...domainListHandlers(
        [{ name: 'alpha', created_at: 1 }],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
        [{ name: 'alpha', created_at: 1, state: 'active' }],
      ),
      relTablesHandler('alpha', []),
      relViewsHandler('alpha', ['v_paid']),
      jsonDetailHandler('alpha', 0),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', []),
    )

    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: /V v_paid/ }))

    expect(screen.getByTestId('sql-route-state')).toHaveTextContent('/sql · SELECT * FROM v_paid LIMIT 50;')
  })

  it('shows the KVREF/JSONREF columns of the expanded domain in the links panel, and hides it when there are none', async () => {
    server.use(
      ...domainListHandlers([], [], [{ name: 'alpha', created_at: 1, state: 'active' }]),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER'), column('customer_ref', 'JSONREF'), column('cart_ref', 'KVREF')]),
    )

    await connectAndRender()

    expect(await screen.findByText('LINKS IN ALPHA')).toBeInTheDocument()
    expect(screen.getByText('orders.customer_ref')).toBeInTheDocument()
    expect(screen.getByText('JSONREF')).toBeInTheDocument()
    expect(screen.getByText('orders.cart_ref')).toBeInTheDocument()
    expect(screen.getByText('KVREF')).toBeInTheDocument()
  })

  it('omits the links panel when the domain has no KVREF/JSONREF columns', async () => {
    server.use(
      ...domainListHandlers([], [], [{ name: 'alpha', created_at: 1, state: 'active' }]),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
    )

    await connectAndRender()

    await screen.findByText(expandedHeader('alpha'))
    expect(screen.queryByText(/LINKS IN/)).not.toBeInTheDocument()
  })

  it('creates a domain without checkboxes: a POST hits all three engines, a partial 409 failure keeps the form open with an inline error', async () => {
    let kvCalls = 0
    let jsonCalls = 0
    let relCalls = 0
    server.use(
      ...domainListHandlers([{ name: 'alpha', created_at: 1 }], [], []),
      kvKeysHandler('alpha', []),
      http.post(`${ORIGIN}/store-api/domains`, () => {
        kvCalls += 1
        return HttpResponse.json({ name: 'shop2', created_at: 1 }, { status: 201 })
      }),
      http.post(`${ORIGIN}/store-api/json/domains`, () => {
        jsonCalls += 1
        return new HttpResponse(null, { status: 409 })
      }),
      http.post(`${ORIGIN}/store-api/rel/domains`, () => {
        relCalls += 1
        return HttpResponse.json({ name: 'shop2', created_at: 1, state: 'active' }, { status: 201 })
      }),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))

    fireEvent.click(screen.getByRole('button', { name: '+ create domain' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('domain name'), { target: { value: 'shop2' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText(/json: 409/)).toBeInTheDocument()
    expect(kvCalls).toBe(1)
    expect(jsonCalls).toBe(1)
    expect(relCalls).toBe(1)
    // Teilfehler -> Formular bleibt offen (spec shell/003 §1)
    expect(screen.getByLabelText('domain name')).toBeInTheDocument()
  })

  it('a fully successful create across all three engines closes the form and invalidates the domain lists', async () => {
    server.use(
      ...domainListHandlers([{ name: 'alpha', created_at: 1 }], [], []),
      kvKeysHandler('alpha', []),
      http.post(`${ORIGIN}/store-api/domains`, () => HttpResponse.json({ name: 'shop2', created_at: 1 }, { status: 201 })),
      http.post(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json({ name: 'shop2', created_at: 1, state: 'active' }, { status: 201 })),
      http.post(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json({ name: 'shop2', created_at: 1, state: 'active' }, { status: 201 })),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))

    fireEvent.click(screen.getByRole('button', { name: '+ create domain' }))
    fireEvent.change(screen.getByLabelText('domain name'), { target: { value: 'shop2' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    await waitFor(() => expect(screen.queryByLabelText('domain name')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '+ create domain' })).toBeInTheDocument()
  })

  it('shows the empty-state hint only once all three domain lists have settled empty, never while one is still pending', async () => {
    let releaseKv: (() => void) | undefined
    const kvGate = new Promise<void>((resolve) => {
      releaseKv = resolve
    })
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, async () => {
        await kvGate
        return HttpResponse.json([])
      }),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
    )

    await connectAndRender()

    expect(screen.queryByText('no domains yet')).not.toBeInTheDocument()

    releaseKv?.()

    expect(await screen.findByText('no domains yet')).toBeInTheDocument()
    expect(screen.getByText('create one to get started')).toBeInTheDocument()
  })

  it('renders only the label row for an empty rel section; its "+" opens the create-table modal', async () => {
    // Der "+" im Label öffnet seit spec sql/002 den Create-Table-Assistenten (natives <dialog> + showModal()).
    // showModal() ist in diesem jsdom (25.0.1) nicht implementiert (nur die `open`-IDL-Property wird reflektiert)
    // — hier gestubbt, weil dieser Test den öffnenden Klick tatsächlich auslöst. Der Formular-Flow selbst ist in
    // CreateTableModal.test.tsx gegen die <dialog>-freie CreateTableForm getestet; hier nur der Einstiegspunkt.
    HTMLDialogElement.prototype.showModal = function showModalStub(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    server.use(
      ...domainListHandlers([], [], [{ name: 'alpha', created_at: 1, state: 'active' }]),
      relTablesHandler('alpha', []),
      relViewsHandler('alpha', []),
    )

    await connectAndRender()

    expect(await screen.findByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^T / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^V / })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'new table' }))

    expect(await screen.findByText('create table · alpha')).toBeInTheDocument()
  })

  it('keeps the label "+" available once the rel section already has tables, not just in the empty state', async () => {
    server.use(
      ...domainListHandlers([], [], [{ name: 'alpha', created_at: 1, state: 'active' }]),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /T orders/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new table' })).toBeInTheDocument()
  })

  it('renders only the label row for empty json/kv sections; their "+" navigates to /data with the right engine', async () => {
    server.use(
      ...domainListHandlers([{ name: 'alpha', created_at: 1 }], [{ name: 'alpha', created_at: 1, state: 'active' }], []),
      jsonDetailHandler('alpha', 0),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', []),
    )

    await connectAndRender()

    expect(await screen.findByText('JSON')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^J documents/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^K keys/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'new document' }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=json')

    fireEvent.click(screen.getByRole('button', { name: 'new key' }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=kv')
  })

  it('shows the label "+" action alongside the object row once a json/kv section is active', async () => {
    server.use(
      ...domainListHandlers([{ name: 'alpha', created_at: 1 }], [{ name: 'alpha', created_at: 1, state: 'active' }], []),
      jsonDetailHandler('alpha', 2),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', ['k1']),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /^J documents/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new document' })).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: /^K keys/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new key' })).toBeInTheDocument()
  })

  it('keeps the "(deleting)" tag on a collapsed row even though the engine holds no more objects', async () => {
    server.use(
      ...domainListHandlers(
        [],
        [
          { name: 'first', created_at: 1, state: 'active' },
          { name: 'shop', created_at: 1, state: 'deleting' },
        ],
        [],
      ),
      jsonDetailHandler('first', 0),
      jsonIndexesHandler('first', 0),
      jsonDetailHandler('shop', 0),
      jsonIndexesHandler('shop', 0),
    )

    await connectAndRender()

    expect(await screen.findByText(expandedHeader('first'))).toBeInTheDocument()
    expect(await screen.findByText('json (deleting)')).toBeInTheDocument()
  })

  it('persists the selected domain across remounts and defaults to the alphabetically first domain otherwise', async () => {
    server.use(
      ...domainListHandlers(
        [
          { name: 'alpha', created_at: 1 },
          { name: 'beta', created_at: 1 },
        ],
        [],
        [],
      ),
      kvKeysHandler('alpha', []),
      kvKeysHandler('beta', []),
    )

    const { unmount } = await connectAndRender()
    expect(await screen.findByText(expandedHeader('alpha'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /▸ beta/ }))
    expect(await screen.findByText(expandedHeader('beta'))).toBeInTheDocument()

    unmount()

    await connectAndRender()
    expect(await screen.findByText(expandedHeader('beta'))).toBeInTheDocument()
    expect(screen.queryByText(expandedHeader('alpha'))).not.toBeInTheDocument()
  })
})

describe('polling intervals (spec shell/007)', () => {
  it('gives ExpandedDomain a 30s refetchInterval and useEngineActivity a 60s refetchInterval on their detail/probe queries', async () => {
    useQuerySpy.mockClear()
    server.use(
      ...domainListHandlers(
        [
          { name: 'alpha', created_at: 1 },
          { name: 'beta', created_at: 1 },
        ],
        [
          { name: 'alpha', created_at: 1, state: 'active' },
          { name: 'beta', created_at: 1, state: 'active' },
        ],
        [
          { name: 'alpha', created_at: 1, state: 'active' },
          { name: 'beta', created_at: 1, state: 'active' },
        ],
      ),
      relTablesHandler('alpha', []),
      relViewsHandler('alpha', []),
      jsonDetailHandler('alpha', 0),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', []),
      relTablesHandler('beta', []),
      relViewsHandler('beta', []),
      jsonDetailHandler('beta', 0),
      jsonIndexesHandler('beta', 0),
      kvKeysHandler('beta', []),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))
    await screen.findByRole('button', { name: /▸ beta/ })

    function refetchIntervalsFor(key: readonly unknown[]): (number | false | undefined)[] {
      return useQuerySpy.mock.calls
        .filter(([options]) => JSON.stringify(options.queryKey) === JSON.stringify(key))
        .map(([options]) => options.refetchInterval)
    }

    // alpha is expanded: ExpandedDomain's own detail query (30s) and useEngineActivity's copy of the same key
    // (60s, called internally by ExpandedDomain too) are both active observers on these four shared keys.
    for (const key of [
      ['rel-tables', 'alpha'],
      ['rel-views', 'alpha'],
      ['json-domain-detail', 'alpha'],
      ['json-indexes', 'alpha'],
    ]) {
      const intervals = refetchIntervalsFor(key)
      expect(intervals).toContain(30_000)
      expect(intervals).toContain(60_000)
    }

    // the kv probe is useEngineActivity-only, even for the expanded domain (ExpandedDomain never queries it directly).
    const alphaKvProbe = refetchIntervalsFor(['kv-keys-probe', 'alpha'])
    expect(alphaKvProbe.length).toBeGreaterThan(0)
    expect(alphaKvProbe.every((value) => value === 60_000)).toBe(true)

    // beta stays collapsed: only useEngineActivity (via CollapsedDomainRow) observes its keys -> 60s only, never 30s.
    for (const key of [
      ['rel-tables', 'beta'],
      ['rel-views', 'beta'],
      ['json-domain-detail', 'beta'],
      ['json-indexes', 'beta'],
      ['kv-keys-probe', 'beta'],
    ]) {
      const intervals = refetchIntervalsFor(key)
      expect(intervals.length).toBeGreaterThan(0)
      expect(intervals.every((value) => value === 60_000)).toBe(true)
    }
  })
})
