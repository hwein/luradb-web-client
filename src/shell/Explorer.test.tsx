import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect } from '../app/session'
import { resetSqlState, useSqlState } from '../screens/sql/sqlStore'
import { server } from '../test/msw'
import { Explorer } from './Explorer'
import { SelectedDomainProvider } from './SelectedDomainContext'

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
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
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

    expect(await screen.findByText('▾ alpha')).toBeInTheDocument()
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
    // kv keys scan resolves empty -> "no keys yet" placeholder, not an active row (spec shell/004 §4).
    expect(await screen.findByText('no keys yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /▸ beta/ }))

    expect(await screen.findByText('▾ beta')).toBeInTheDocument()
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

    await screen.findByText('▾ alpha')
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
    await screen.findByText('▾ alpha')

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
    await screen.findByText('▾ alpha')

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

  // "+ new table" öffnet seit spec sql/002 den Create-Table-Assistenten (natives <dialog> + showModal()) statt
  // direkt einen SQL-Tab zu befüllen. showModal() ist in diesem jsdom (25.0.1) nicht implementiert (nur die
  // `open`-IDL-Property wird reflektiert) — ein Klick hier würde crashen. Der Modal-Formular-Flow selbst ist in
  // CreateTableModal.test.tsx gegen die <dialog>-freie CreateTableForm getestet; hier nur der Einstiegspunkt.
  it('shows a "no tables yet" placeholder for an empty rel domain, with "+ new table" available', async () => {
    server.use(
      ...domainListHandlers([], [], [{ name: 'alpha', created_at: 1, state: 'active' }]),
      relTablesHandler('alpha', []),
      relViewsHandler('alpha', []),
    )

    await connectAndRender()

    expect(await screen.findByText('no tables yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ new table' })).toBeInTheDocument()
  })

  it('keeps "+ new table" available once the rel domain already has tables, not just in the empty state', async () => {
    server.use(
      ...domainListHandlers([], [], [{ name: 'alpha', created_at: 1, state: 'active' }]),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /T orders/ })).toBeInTheDocument()
    expect(screen.queryByText('no tables yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ new table' })).toBeInTheDocument()
  })

  it('shows "no documents yet"/"no keys yet" placeholders for empty json/kv stores; their entry links navigate to /data with the right engine', async () => {
    server.use(
      ...domainListHandlers([{ name: 'alpha', created_at: 1 }], [{ name: 'alpha', created_at: 1, state: 'active' }], []),
      jsonDetailHandler('alpha', 0),
      jsonIndexesHandler('alpha', 0),
      kvKeysHandler('alpha', []),
    )

    await connectAndRender()

    expect(await screen.findByText('no documents yet')).toBeInTheDocument()
    expect(await screen.findByText('no keys yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ new document' }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=json')

    fireEvent.click(screen.getByRole('button', { name: '+ new key' }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=kv')
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

    expect(await screen.findByText('▾ first')).toBeInTheDocument()
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
    expect(await screen.findByText('▾ alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /▸ beta/ }))
    expect(await screen.findByText('▾ beta')).toBeInTheDocument()

    unmount()

    await connectAndRender()
    expect(await screen.findByText('▾ beta')).toBeInTheDocument()
    expect(screen.queryByText('▾ alpha')).not.toBeInTheDocument()
  })
})
