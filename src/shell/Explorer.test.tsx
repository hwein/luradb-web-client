import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect } from '../app/session'
import { resetSqlState, useSqlState } from '../screens/sql/sqlStore'
import { domainResponse, server } from '../test/msw'
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

function domainsHandler(domains: ReturnType<typeof domainResponse>[]) {
  return http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json(domains))
}

/** Empty answers for the per-engine probes of every domain; a test's own handlers are registered later and win. */
function emptyEngineHandlers() {
  return [
    http.get(`${ORIGIN}/store-api/rel/:domain/tables`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/:domain/views`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/:domain/documents/count`, () => HttpResponse.json({ count: 0 })),
    http.get(`${ORIGIN}/store-api/json/:domain/indexes`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/kv/:domain/count`, () => HttpResponse.json({ count: 0 })),
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

function jsonCountHandler(domain: string, count: number) {
  return http.get(`${ORIGIN}/store-api/json/${domain}/documents/count`, () => HttpResponse.json({ count }))
}

function jsonIndexesHandler(domain: string, count: number) {
  return http.get(`${ORIGIN}/store-api/json/${domain}/indexes`, () =>
    HttpResponse.json(Array.from({ length: count }, (_, index) => ({ field: `f${index}`, type: 'string', created_at: 1 }))),
  )
}

function kvCountHandler(domain: string, count: number) {
  return http.get(`${ORIGIN}/store-api/kv/${domain}/count`, () => HttpResponse.json({ count }))
}

function relTableCountHandler(domain: string, table: string, count: number) {
  return http.get(`${ORIGIN}/store-api/rel/${domain}/tables/${table}/count`, () => HttpResponse.json({ count }))
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
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  const rendered = render(
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
  return { ...rendered, queryClient }
}

beforeEach(() => {
  server.use(...emptyEngineHandlers())
})

afterEach(() => {
  act(() => disconnect())
  resetSqlState()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

describe('Explorer', () => {
  it('expands the alphabetically first domain and tags the collapsed ones by activity', async () => {
    server.use(
      domainsHandler([domainResponse('alpha'), domainResponse('beta'), domainResponse('gamma')]),
      // beta/gamma are collapsed -> their tags follow actual activity.
      jsonCountHandler('beta', 1),
      jsonIndexesHandler('beta', 0),
      kvCountHandler('beta', 1),
      kvCountHandler('gamma', 1),
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

  it('shows all three engine sections for every domain', async () => {
    server.use(domainsHandler([domainResponse('alpha'), domainResponse('beta')]))

    await connectAndRender()

    expect(await screen.findByText(expandedHeader('alpha'))).toBeInTheDocument()
    expect(screen.getByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
    expect(screen.getByText('KEY-VALUE')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /▸ beta/ }))

    expect(await screen.findByText(expandedHeader('beta'))).toBeInTheDocument()
    expect(screen.getByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
    expect(screen.getByText('KEY-VALUE')).toBeInTheDocument()
  })

  it('hides the section of an engine whose endpoints answer 503 on first load', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      http.get(`${ORIGIN}/store-api/rel/:domain/tables`, () => HttpResponse.text('Relational engine disabled', { status: 503 })),
      http.get(`${ORIGIN}/store-api/json/:domain/indexes`, () => HttpResponse.text('JSON engine disabled', { status: 503 })),
      kvCountHandler('alpha', 1),
    )

    await connectAndRender()

    expect(await screen.findByText(expandedHeader('alpha'))).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('RELATIONAL')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText('JSON')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'new table' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'new document' })).not.toBeInTheDocument()
    expect(screen.getByText('KEY-VALUE')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^K keys/ })).toBeInTheDocument()
  })

  it('keeps the section when an engine endpoint fails with another status', async () => {
    let releaseJson: (() => void) | undefined
    const relAnswered = new Promise<void>((resolve) => {
      releaseJson = resolve
    })
    server.use(
      domainsHandler([domainResponse('alpha')]),
      http.get(`${ORIGIN}/store-api/rel/alpha/tables`, () => {
        releaseJson?.()
        return HttpResponse.text('internal error', { status: 500 })
      }),
      // answers only after the 500: once JSON is gone, the rel failure has settled too
      http.get(`${ORIGIN}/store-api/json/alpha/documents/count`, async () => {
        await relAnswered
        return HttpResponse.text('JSON engine disabled', { status: 503 })
      }),
    )

    await connectAndRender()

    expect(await screen.findByText(expandedHeader('alpha'))).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('JSON')).not.toBeInTheDocument())
    expect(screen.getByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new table' })).toBeInTheDocument()
    expect(screen.getByText('KEY-VALUE')).toBeInTheDocument()
  })

  it('keeps the section when an engine endpoint answers 503 after an earlier success', async () => {
    let relDisabled = false
    let relDisabledAnswers = 0
    server.use(
      domainsHandler([domainResponse('alpha')]),
      http.get(`${ORIGIN}/store-api/rel/alpha/tables`, () => {
        if (!relDisabled) return HttpResponse.json([{ name: 'orders', _links: { self: '', rows: '' } }])
        relDisabledAnswers += 1
        return HttpResponse.text('Relational engine disabled', { status: 503 })
      }),
      relTableCountHandler('alpha', 'orders', 3),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
    )

    const { queryClient } = await connectAndRender()

    expect(await screen.findByRole('button', { name: /T orders/ })).toBeInTheDocument()

    relDisabled = true
    await act(() => queryClient.invalidateQueries({ queryKey: ['rel-tables', 'alpha'] }))
    await waitFor(() => expect(relDisabledAnswers).toBeGreaterThan(0))
    await waitFor(() => expect(queryClient.getQueryState(['rel-tables', 'alpha'])?.status).toBe('error'))

    expect(screen.getByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new table' })).toBeInTheDocument()
  })

  it('loads the sections of the expanded domain and switches expansion on click', async () => {
    server.use(
      domainsHandler([domainResponse('alpha'), domainResponse('beta')]),
      relTablesHandler('alpha', ['orders']),
      relTableCountHandler('alpha', 'orders', 3),
      relViewsHandler('alpha', ['v_paid']),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      jsonCountHandler('alpha', 3),
      jsonIndexesHandler('alpha', 1),
      kvCountHandler('alpha', 0),
      kvCountHandler('beta', 0),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /T orders/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /V v_paid/ })).toBeInTheDocument()
    expect(await screen.findByText('3 · idx 1')).toBeInTheDocument()
    // kv count resolves 0 -> only the label row's "+" action, no active row (spec shell/004 §4).
    expect(await screen.findByRole('button', { name: 'new key' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^K keys/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /▸ beta/ }))

    expect(await screen.findByText(expandedHeader('beta'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /▸ alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /T orders/ })).not.toBeInTheDocument()
  })

  it('navigates to /data with the engine and table as query params on object-row clicks', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      relTablesHandler('alpha', ['orders']),
      relTableCountHandler('alpha', 'orders', 3),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      jsonCountHandler('alpha', 1),
      jsonIndexesHandler('alpha', 0),
      kvCountHandler('alpha', 2),
    )

    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: /T orders/ }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=rel&table=orders')

    fireEvent.click(await screen.findByRole('button', { name: /^J documents/ }))
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=json')

    // aktiver kv-Store zeigt den Zähler aus GET …/kv/{d}/count (spec shell/004 §4, shell/010 §2).
    const keysButton = await screen.findByRole('button', { name: /^K keys/ })
    expect(keysButton).toHaveTextContent('2')
    fireEvent.click(keysButton)
    expect(screen.getByTestId('data-route-state')).toHaveTextContent('/data?engine=kv')
  })

  it('a view click opens the SQL console with a new LIMIT-50 select tab instead of the rel browser (no rows endpoint for views)', async () => {
    server.use(domainsHandler([domainResponse('alpha')]), relViewsHandler('alpha', ['v_paid']))

    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: /V v_paid/ }))

    expect(screen.getByTestId('sql-route-state')).toHaveTextContent('/sql · SELECT * FROM v_paid LIMIT 50;')
  })

  it('shows the KVREF/JSONREF columns of the expanded domain in the links panel, and hides it when there are none', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      relTablesHandler('alpha', ['orders']),
      relTableCountHandler('alpha', 'orders', 3),
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
      domainsHandler([domainResponse('alpha')]),
      relTablesHandler('alpha', ['orders']),
      relTableCountHandler('alpha', 'orders', 3),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
    )

    await connectAndRender()

    await screen.findByText(expandedHeader('alpha'))
    expect(screen.queryByText(/LINKS IN/)).not.toBeInTheDocument()
  })

  it('shows a failed create as status and message and keeps the form open', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      http.post(`${ORIGIN}/store-api/domains`, () => new HttpResponse(null, { status: 409 })),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))

    fireEvent.click(screen.getByRole('button', { name: '+ create domain' }))
    expect(screen.getByRole('checkbox', { name: 'require conditional writes' })).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('domain name'), { target: { value: 'shop2' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('409 domain already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('domain name')).toBeInTheDocument()
  })

  it('sends require_conditional_writes as an object for kv and json', async () => {
    const bodies: unknown[] = []
    server.use(
      domainsHandler([domainResponse('alpha')]),
      http.post(`${ORIGIN}/store-api/domains`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(domainResponse('shop2'), { status: 201 })
      }),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))

    fireEvent.click(screen.getByRole('button', { name: '+ create domain' }))
    expect(screen.getByText('writes need If-Match / If-None-Match (428 otherwise)')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('domain name'), { target: { value: 'shop2' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    await waitFor(() => expect(screen.queryByLabelText('domain name')).not.toBeInTheDocument())
    expect(bodies).toEqual([{ name: 'shop2' }])

    fireEvent.click(screen.getByRole('button', { name: '+ create domain' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'require conditional writes' }))
    fireEvent.change(screen.getByLabelText('domain name'), { target: { value: 'shop2' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    await waitFor(() => expect(screen.queryByLabelText('domain name')).not.toBeInTheDocument())
    expect(bodies).toEqual([{ name: 'shop2' }, { name: 'shop2', require_conditional_writes: { kv: true, json: true } }])
  })

  it('shows the conditional writes tag', async () => {
    server.use(
      domainsHandler([
        domainResponse('alpha', { require_conditional_writes: { kv: true, json: false } }),
        domainResponse('beta', { require_conditional_writes: { kv: false, json: true } }),
        domainResponse('gamma'),
      ]),
    )

    await connectAndRender()

    const expandedTag = await screen.findByText('conditional writes', { selector: '.explorer__domain-tag' })
    expect(expandedTag).toHaveAttribute('title', 'require_conditional_writes: kv')
    const collapsedRow = await screen.findByRole('button', { name: /▸ beta.*conditional writes/ })
    expect(collapsedRow).toHaveAttribute('title', 'require_conditional_writes: json')
    expect(collapsedRow).toHaveAccessibleDescription('require_conditional_writes: json')
    expect(screen.getByText('conditional writes', { selector: '.explorer__engine-tags' })).not.toHaveAttribute('title')
    expect(screen.getAllByText('conditional writes')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /▸ gamma/ }))
    await screen.findByText(expandedHeader('gamma'))
    expect(screen.queryByText('conditional writes', { selector: '.explorer__domain-tag' })).not.toBeInTheDocument()
    expect(screen.getAllByText('conditional writes', { selector: '.explorer__engine-tags' })).toHaveLength(2)
  })

  it('creates a domain with a single POST and closes the form', async () => {
    let created = false
    let posts = 0
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, () =>
        HttpResponse.json(created ? [domainResponse('alpha'), domainResponse('shop2')] : [domainResponse('alpha')]),
      ),
      http.post(`${ORIGIN}/store-api/domains`, () => {
        posts += 1
        created = true
        return HttpResponse.json(domainResponse('shop2'), { status: 201 })
      }),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))

    fireEvent.click(screen.getByRole('button', { name: '+ create domain' }))
    fireEvent.change(screen.getByLabelText('domain name'), { target: { value: 'shop2' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    await waitFor(() => expect(screen.queryByLabelText('domain name')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '+ create domain' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /▸ shop2/ })).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('shows the empty-state hint only once the domain list has settled empty, never while it is still pending', async () => {
    let releaseList: (() => void) | undefined
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    server.use(
      http.get(`${ORIGIN}/store-api/domains`, async () => {
        await listGate
        return HttpResponse.json([])
      }),
    )

    await connectAndRender()

    expect(screen.queryByText('no domains yet')).not.toBeInTheDocument()

    releaseList?.()

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
    server.use(domainsHandler([domainResponse('alpha')]))

    await connectAndRender()

    expect(await screen.findByText('RELATIONAL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^T / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^V / })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'new table' }))

    expect(await screen.findByText('create table · alpha')).toBeInTheDocument()
  })

  it('the create-table modal\'s "from csv/tsv file…" link swaps it for the file-import modal', async () => {
    HTMLDialogElement.prototype.showModal = function showModalStub(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    server.use(domainsHandler([domainResponse('alpha')]))

    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'new table' }))
    fireEvent.click(await screen.findByRole('button', { name: 'from csv/tsv file…' }))

    expect(await screen.findByText('create table from file · alpha')).toBeInTheDocument()
    expect(screen.queryByText('create table · alpha')).not.toBeInTheDocument()
  })

  it('keeps the label "+" available once the rel section already has tables, not just in the empty state', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      relTablesHandler('alpha', ['orders']),
      relTableCountHandler('alpha', 'orders', 3),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /T orders/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new table' })).toBeInTheDocument()
  })

  it('renders only the label row for empty json/kv sections; their "+" navigates to /data with the right engine', async () => {
    server.use(domainsHandler([domainResponse('alpha')]))

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
      domainsHandler([domainResponse('alpha')]),
      jsonCountHandler('alpha', 2),
      jsonIndexesHandler('alpha', 0),
      kvCountHandler('alpha', 1),
    )

    await connectAndRender()

    expect(await screen.findByRole('button', { name: /^J documents/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new document' })).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: /^K keys/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new key' })).toBeInTheDocument()
  })

  it('persists the selected domain across remounts and defaults to the alphabetically first domain otherwise', async () => {
    server.use(domainsHandler([domainResponse('alpha'), domainResponse('beta')]))

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

describe('object counts via the count endpoints (spec shell/010)', () => {
  it('shows the row count on table rows, leaves views without a number and never requests a view count', async () => {
    const countRequests: string[] = []
    server.use(
      domainsHandler([domainResponse('alpha')]),
      relTablesHandler('alpha', ['orders', 'order_items']),
      relViewsHandler('alpha', ['v_paid_orders']),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      relTableDetailHandler('alpha', 'order_items', [column('id', 'INTEGER')]),
      http.get(`${ORIGIN}/store-api/rel/alpha/tables/:table/count`, ({ params }) => {
        countRequests.push(String(params.table))
        return HttpResponse.json({ count: params.table === 'orders' ? 12400 : 40100 })
      }),
      http.get(`${ORIGIN}/store-api/rel/alpha/views/:view/count`, ({ params }) => {
        countRequests.push(`view:${String(params.view)}`)
        return new HttpResponse(null, { status: 404 })
      }),
    )

    await connectAndRender()

    const orders = await screen.findByRole('button', { name: /T orders/ })
    await waitFor(() => expect(orders.querySelector('.explorer__object-count')).toHaveTextContent('12.4k'))
    const orderItems = screen.getByRole('button', { name: /T order_items/ })
    await waitFor(() => expect(orderItems.querySelector('.explorer__object-count')).toHaveTextContent('40.1k'))

    const view = screen.getByRole('button', { name: /V v_paid_orders/ })
    expect(view.querySelector('.explorer__object-count')).not.toBeInTheDocument()
    expect(countRequests.sort()).toEqual(['order_items', 'orders'])
  })

  it('renders the table row without a number when the count endpoint fails (no 0 on suspicion, no error text)', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      http.get(`${ORIGIN}/store-api/rel/alpha/tables/orders/count`, () => HttpResponse.text('table not found', { status: 404 })),
    )

    await connectAndRender()

    const orders = await screen.findByRole('button', { name: /T orders/ })
    await waitFor(() => expect(screen.queryByText('RELATIONAL')).toBeInTheDocument())
    expect(orders.querySelector('.explorer__object-count')).not.toBeInTheDocument()
    expect(orders).toHaveTextContent(/^T\s*orders$/)
    expect(screen.queryByText(/table not found/)).not.toBeInTheDocument()
  })

  it('derives the kv activity from GET …/count (0 => empty, N => active with the count) and never lists keys for it', async () => {
    let keyScans = 0
    server.use(
      domainsHandler([domainResponse('alpha'), domainResponse('beta')]),
      http.get(`${ORIGIN}/store-api/kv/:domain/keys`, () => {
        keyScans += 1
        return HttpResponse.json({ keys: ['leak'], total: 1, offset: 0, limit: 1000 })
      }),
      kvCountHandler('alpha', 7),
      kvCountHandler('beta', 0),
    )

    await connectAndRender()

    const keysButton = await screen.findByRole('button', { name: /^K keys/ })
    expect(keysButton.querySelector('.explorer__object-count')).toHaveTextContent('7')
    // beta is collapsed and empty: no "kv" activity tag
    await waitFor(() => expect(screen.getByRole('button', { name: /▸ beta/ })).not.toHaveTextContent('kv'))
    expect(keyScans).toBe(0)
  })

  it('treats a failing kv count as pending: no dot, no tag, no keys row', async () => {
    server.use(
      domainsHandler([domainResponse('alpha')]),
      http.get(`${ORIGIN}/store-api/kv/alpha/count`, () => HttpResponse.text('Domain not found', { status: 404 })),
    )

    await connectAndRender()

    expect(await screen.findByText('KEY-VALUE')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'new key' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^K keys/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Domain not found/)).not.toBeInTheDocument()
  })
})

describe('polling intervals (spec shell/007)', () => {
  it('gives ExpandedDomain a 30s refetchInterval and useEngineActivity a 60s refetchInterval on their detail/probe queries', async () => {
    useQuerySpy.mockClear()
    server.use(
      domainsHandler([domainResponse('alpha'), domainResponse('beta')]),
      relTablesHandler('alpha', ['orders']),
      relViewsHandler('alpha', []),
      relTableDetailHandler('alpha', 'orders', [column('id', 'INTEGER')]),
      relTableCountHandler('alpha', 'orders', 5),
      jsonCountHandler('alpha', 0),
      jsonIndexesHandler('alpha', 0),
      kvCountHandler('alpha', 0),
      relTablesHandler('beta', []),
      relViewsHandler('beta', []),
      jsonCountHandler('beta', 0),
      jsonIndexesHandler('beta', 0),
      kvCountHandler('beta', 0),
    )

    await connectAndRender()
    await screen.findByText(expandedHeader('alpha'))
    await screen.findByRole('button', { name: /▸ beta/ })
    await screen.findByRole('button', { name: /T orders/ })

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
      ['json-count', 'alpha'],
      ['json-indexes', 'alpha'],
    ]) {
      const intervals = refetchIntervalsFor(key)
      expect(intervals).toContain(30_000)
      expect(intervals).toContain(60_000)
    }

    // the kv count is useEngineActivity-only, even for the expanded domain (ExpandedDomain never queries it directly).
    const alphaKvProbe = refetchIntervalsFor(['kv-count', 'alpha'])
    expect(alphaKvProbe.length).toBeGreaterThan(0)
    expect(alphaKvProbe.every((value) => value === 60_000)).toBe(true)

    // table row counts are O(n) server-side (spec shell/010 §7): 60s like the activity probes, never the 30s of the lists.
    const alphaTableCount = refetchIntervalsFor(['rel-table-count', 'alpha', 'orders'])
    expect(alphaTableCount.length).toBeGreaterThan(0)
    expect(alphaTableCount.every((value) => value === 60_000)).toBe(true)

    // beta stays collapsed: only useEngineActivity (via CollapsedDomainRow) observes its keys -> 60s only, never 30s.
    for (const key of [
      ['rel-tables', 'beta'],
      ['rel-views', 'beta'],
      ['json-count', 'beta'],
      ['json-indexes', 'beta'],
      ['kv-count', 'beta'],
    ]) {
      const intervals = refetchIntervalsFor(key)
      expect(intervals.length).toBeGreaterThan(0)
      expect(intervals.every((value) => value === 60_000)).toBe(true)
    }
  })
})
