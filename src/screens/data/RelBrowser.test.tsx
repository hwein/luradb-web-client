import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type HttpHandler } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { server } from '../../test/msw'
import { resetDocsState, useDocsState } from '../docs/docsStore'
import { DataScreen } from './DataScreen'

const ORIGIN = window.location.origin
const DOMAIN = 'shop'
const TABLE = 'orders'
const TABLE_URL = `${ORIGIN}/store-api/rel/${DOMAIN}/tables/${TABLE}`
const ROWS_URL = `${ORIGIN}/store-api/rel/${DOMAIN}/tables/${TABLE}/rows`
const SQL_URL = `${ORIGIN}/store-api/rel/${DOMAIN}/sql`

const COLUMNS = [
  { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, autoincrement: true, unique: false },
  { name: 'total', type: 'REAL', nullable: false, primary_key: false, autoincrement: false, unique: false },
  { name: 'label', type: 'TEXT', nullable: true, primary_key: false, autoincrement: false, unique: false },
  { name: 'cart_ref', type: 'KVREF', nullable: true, primary_key: false, autoincrement: false, unique: false },
  { name: 'customer_ref', type: 'JSONREF', nullable: true, primary_key: false, autoincrement: false, unique: false },
]

function rowUrl(pk: string): string {
  return `${ROWS_URL}/${pk}`
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
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([{ name: DOMAIN, created_at: 1, state: 'active' }])),
    http.get(TABLE_URL, () =>
      HttpResponse.json({ name: TABLE, created_at: 1, indexes: [{ name: 'idx_label', column: 'label', unique: false }], _links: { self: '', rows: '' }, columns: COLUMNS }),
    ),
    // Ref-Picker-Quellen (spec 004 §2) — Default leer, einzelne Tests überschreiben mit echtem Bestand.
    http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents`, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
    http.get(`${ORIGIN}/store-api/kv/${DOMAIN}/keys`, () => HttpResponse.json([])),
  ]
}

function DocsRouteProbe() {
  const docs = useDocsState()
  return <p data-testid="docs-screen">docs: {docs.activeId ?? ''}</p>
}

/** `extraHandlers` registriert nach den Basis-Handlern (MSW: zuletzt registriert gewinnt) — für Tests, die z. B. TABLE_URL überschreiben müssen. */
async function connectAndRender(initialPath = `/data?engine=rel&table=${TABLE}`, extraHandlers: HttpHandler[] = []) {
  server.use(...baseHandlers())
  if (extraHandlers.length > 0) server.use(...extraHandlers)
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SelectedDomainProvider>
          <Routes>
            <Route path="/data" element={<DataScreen />} />
            <Route path="/docs" element={<DocsRouteProbe />} />
          </Routes>
        </SelectedDomainProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function footerText(): string {
  return document.querySelector('.data__footer')?.textContent ?? ''
}

function chipFor(text: string): Element | undefined {
  return Array.from(document.querySelectorAll('.rel__col-chip')).find((el) => el.textContent?.includes(text))
}

afterEach(() => {
  act(() => disconnect())
  resetDocsState()
})

describe('RelBrowser', () => {
  it('renders schema chips (PK dot marker, REF-target coloring) and the index pill', async () => {
    server.use(http.get(ROWS_URL, () => HttpResponse.json({ rows: [], row_count: 0, limit: 50, offset: 0, limit_applied: false })))
    await connectAndRender()

    expect(await screen.findByText('shop / orders')).toBeInTheDocument()
    // Schema-Zeile rendert erst, sobald TableDetail geladen ist — auf ein dort exklusives Element warten statt auf den Kopf (der schon im Loading-Zustand steht).
    await screen.findByText('idx: label')

    expect(chipFor('id·INTEGER')).toBeDefined()
    expect(chipFor('id·INTEGER')?.querySelector('.rel__col-chip__pk')).not.toBeNull()
    expect(chipFor('total·REAL')).toBeDefined()
    expect(chipFor('total·REAL')?.querySelector('.rel__col-chip__pk')).toBeNull()
    expect(chipFor('cart_ref·KVREF')).toHaveClass('rel__col-chip--kv')
    expect(chipFor('customer_ref·JSONREF')).toHaveClass('rel__col-chip--json')
  })

  // Der Assistent selbst (Formular-Führung, Generator, Abschluss-Fluss) ist dialogfrei in AlterTableModal.test.tsx
  // gegen AlterTableForm getestet (jsdom-Grenze wie sql/002) — hier nur der Einstiegspunkt neben der idx-Pill.
  it('shows the "alter table" entry point next to the index pill', async () => {
    server.use(http.get(ROWS_URL, () => HttpResponse.json({ rows: [], row_count: 0, limit: 50, offset: 0, limit_applied: false })))
    await connectAndRender()

    await screen.findByText('idx: label')
    expect(screen.getByRole('button', { name: 'alter table' })).toBeInTheDocument()
  })

  it('lists rows via GET with limit/offset, shows the call + limit-applied note, and pages via load more', async () => {
    server.use(
      http.get(ROWS_URL, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        if (offset === 0) {
          return HttpResponse.json({
            rows: [{ id: 1, total: 10, label: 'a', cart_ref: null, customer_ref: null }],
            row_count: 1,
            limit: 50,
            offset: 0,
            limit_applied: true,
          })
        }
        return HttpResponse.json({
          rows: [{ id: 2, total: 20, label: 'b', cart_ref: null, customer_ref: null }],
          row_count: 1,
          limit: 50,
          offset: 1,
          limit_applied: false,
        })
      }),
    )
    await connectAndRender()

    expect(await screen.findByText('ROW 1')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain('1 rows'))
    expect(footerText()).toContain('limit applied')
    expect(footerText()).toContain(`GET /store-api/rel/${DOMAIN}/tables/${TABLE}/rows?limit=50&offset=0`)

    fireEvent.click(screen.getByRole('button', { name: 'load more' }))

    await waitFor(() => expect(footerText()).toContain('2 rows'))
    expect(footerText()).not.toContain('limit applied')
    expect(screen.queryByRole('button', { name: 'load more' })).not.toBeInTheDocument()
  })

  it('expand toggle adds _expanded columns; a dangling link is muted with a docs link to cross-engine-links', async () => {
    server.use(
      http.get(ROWS_URL, ({ request }) => {
        const expand = new URL(request.url).searchParams.get('expand')
        const rows =
          expand === '*'
            ? [
                {
                  id: 1,
                  total: 10,
                  label: 'valid',
                  cart_ref: 'cart_1',
                  customer_ref: 'doc_1',
                  _expanded: { cart_ref: { encoding: 'utf8', exists: true, value: 'cart-contents' }, customer_ref: { document: { name: 'A. Roth' }, exists: true } },
                },
                {
                  id: 2,
                  total: 20,
                  label: 'dangling',
                  cart_ref: 'cart_missing',
                  customer_ref: 'doc_missing',
                  _expanded: { cart_ref: { exists: false, value: null }, customer_ref: { document: null, exists: false } },
                },
              ]
            : [
                { id: 1, total: 10, label: 'valid', cart_ref: 'cart_1', customer_ref: 'doc_1' },
                { id: 2, total: 20, label: 'dangling', cart_ref: 'cart_missing', customer_ref: 'doc_missing' },
              ]
        return HttpResponse.json({ rows, row_count: rows.length, limit: 50, offset: 0, limit_applied: false })
      }),
    )
    await connectAndRender()
    await screen.findByText('ROW 1')
    expect(screen.queryByText('_expanded.cart_ref')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'expand' }))

    expect(await screen.findByText('_expanded.cart_ref')).toBeInTheDocument()
    expect(screen.getByText('_expanded.customer_ref')).toBeInTheDocument()
    expect(document.querySelector('.rel-grid')?.textContent).toContain('cart-contents')

    const danglingCells = screen.getAllByText('{"exists":false} — dangling link ·', { exact: false })
    expect(danglingCells.length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: 'docs' })[0]!)
    expect(await screen.findByTestId('docs-screen')).toHaveTextContent('docs: cross-engine-links')
  })

  it('creates a row via POST, leaving the autoincrement PK out of the body, then selects the new row', async () => {
    const rows: Record<string, unknown>[] = []
    let postBody: unknown
    server.use(
      http.get(ROWS_URL, () => HttpResponse.json({ rows, row_count: rows.length, limit: 50, offset: 0, limit_applied: false })),
      http.post(ROWS_URL, async ({ request }) => {
        postBody = await request.json()
        rows.push({ id: 3, total: 99.5, label: null, cart_ref: null, customer_ref: null })
        return HttpResponse.json({ affected: 1, last_pk: 3 }, { status: 201 })
      }),
    )
    await connectAndRender()
    await screen.findByText('no rows')

    fireEvent.click(screen.getByRole('button', { name: '+ new row' }))
    fireEvent.change(screen.getByLabelText('total'), { target: { value: '99.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    await waitFor(() => expect(postBody).toEqual({ total: 99.5 }))
    expect(await screen.findByText('ROW 3')).toBeInTheDocument()
  })

  it('edits a row via PUT (partial body, PK excluded) and supports the null-checkbox for a nullable column', async () => {
    let putBody: unknown
    const row = { id: 1, total: 214.9, label: 'valid', cart_ref: 'cart_1', customer_ref: 'doc_1' }
    server.use(
      http.get(ROWS_URL, () => HttpResponse.json({ rows: [row], row_count: 1, limit: 50, offset: 0, limit_applied: false })),
      http.put(rowUrl('1'), async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({ affected: 1, last_pk: null })
      }),
    )
    await connectAndRender()
    await screen.findByText('ROW 1')

    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fireEvent.change(screen.getByLabelText('label'), { target: { value: 'renamed' } })
    fireEvent.click(screen.getByLabelText('cart_ref is null'))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(putBody).toEqual({ total: 214.9, label: 'renamed', cart_ref: null, customer_ref: 'doc_1' }))
    expect(await screen.findByRole('button', { name: 'edit' })).toBeInTheDocument()
  })

  it('shows a 409 link-validation conflict with the server message and a why? link to docs', async () => {
    const row = { id: 1, total: 214.9, label: 'valid', cart_ref: 'cart_1', customer_ref: 'doc_1' }
    server.use(
      http.get(ROWS_URL, () => HttpResponse.json({ rows: [row], row_count: 1, limit: 50, offset: 0, limit_applied: false })),
      http.put(
        rowUrl('1'),
        () => new HttpResponse("cross-engine link target 'cart_missing' of column 'cart_ref' is missing in kv", { status: 409, headers: { 'Content-Type': 'text/plain' } }),
      ),
    )
    await connectAndRender()
    await screen.findByText('ROW 1')

    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fireEvent.change(screen.getByLabelText('cart_ref'), { target: { value: 'cart_missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(await screen.findByText(/cross-engine link target 'cart_missing' of column 'cart_ref' is missing in kv/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'why?' }))
    expect(await screen.findByTestId('docs-screen')).toHaveTextContent('docs: cross-engine-links')
  })

  it('deletes a row via DELETE after a confirmation click, and clears the selection', async () => {
    let deleted = false
    server.use(
      http.get(ROWS_URL, () =>
        HttpResponse.json({
          rows: deleted ? [] : [{ id: 1, total: 1, label: 'gone-soon', cart_ref: null, customer_ref: null }],
          row_count: deleted ? 0 : 1,
          limit: 50,
          offset: 0,
          limit_applied: false,
        }),
      ),
      http.delete(rowUrl('1'), () => {
        deleted = true
        return HttpResponse.json({ affected: 1, last_pk: null })
      }),
    )
    await connectAndRender()
    await screen.findByText('ROW 1')

    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete — sure?' }))

    await waitFor(() => expect(screen.queryByText('ROW 1')).not.toBeInTheDocument())
    expect(await screen.findByText('select a row')).toBeInTheDocument()
  })

  it('arrives filtered (referenced-by style params): fetches via POST /sql, shows the filter bar, and × clears back to GET rows', async () => {
    let sqlCalls = 0
    server.use(
      http.get(ROWS_URL, () => HttpResponse.json({ rows: [], row_count: 0, limit: 50, offset: 0, limit_applied: false })),
      http.post(SQL_URL, async ({ request }) => {
        sqlCalls += 1
        expect(await request.json()).toEqual({ sql: 'SELECT * FROM orders WHERE customer_ref = ? LIMIT 50', params: ['doc_1'] })
        return HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'total', type: 'REAL' },
            { name: 'label', type: 'TEXT' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [[1, 214.9, 'valid', 'cart_1', 'doc_1']],
          row_count: 1,
          limit_applied: false,
        })
      }),
    )
    await connectAndRender(`/data?engine=rel&table=${TABLE}&filterCol=customer_ref&filterVal=doc_1`)

    expect(await screen.findByText(/filtered: customer_ref = doc_1/)).toBeInTheDocument()
    expect(await screen.findByText('ROW 1')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain(`POST /store-api/rel/${DOMAIN}/sql`))
    expect(sqlCalls).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'clear filter' }))

    await waitFor(() => expect(screen.queryByText(/filtered:/)).not.toBeInTheDocument())
    await waitFor(() => expect(footerText()).toContain(`GET /store-api/rel/${DOMAIN}/tables/${TABLE}/rows`))
    expect(sqlCalls).toBe(1)
  })

  it('coerces the filter value by column type: the INTEGER-pk jump from the dangling report sends a number param', async () => {
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        expect(await request.json()).toEqual({ sql: 'SELECT * FROM orders WHERE id = ? LIMIT 50', params: [3] })
        return HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'total', type: 'REAL' },
            { name: 'label', type: 'TEXT' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [[3, 5.5, 'dangling', 'cart_1', 'doc_gone']],
          row_count: 1,
          limit_applied: false,
        })
      }),
    )
    await connectAndRender(`/data?engine=rel&table=${TABLE}&filterCol=id&filterVal=3`)

    expect(await screen.findByText(/filtered: id = 3/)).toBeInTheDocument()
    expect(await screen.findByText('ROW 3')).toBeInTheDocument()
  })

  it('shows the server message in the filter bar when the filtered query fails, instead of a silent "no rows"', async () => {
    server.use(
      http.post(SQL_URL, () =>
        new HttpResponse('type mismatch in value for id: expected Integer, got text', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ),
    )
    await connectAndRender(`/data?engine=rel&table=${TABLE}&filterCol=id&filterVal=oops`)

    expect(await screen.findByText(/type mismatch in value for id/)).toBeInTheDocument()
  })

  it('offers KVREF/JSONREF ref-picker options from the existing document/key listings, and free text still works', async () => {
    server.use(http.get(ROWS_URL, () => HttpResponse.json({ rows: [], row_count: 0, limit: 50, offset: 0, limit_applied: false })))
    await connectAndRender(`/data?engine=rel&table=${TABLE}`, [
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents`, () =>
        HttpResponse.json({
          documents: [{ _key: 'doc_1', _version: 1, city: 'Essen' }],
          keys: ['doc_1'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      http.get(`${ORIGIN}/store-api/kv/${DOMAIN}/keys`, () => HttpResponse.json(['cart_1', 'cart_2'])),
    ])
    await screen.findByText('no rows')

    fireEvent.click(screen.getByRole('button', { name: '+ new row' }))

    const jsonrefInput = await screen.findByLabelText('customer_ref')
    expect(jsonrefInput).toHaveAttribute('list', 'rel-row-form-jsonref-options')
    await waitFor(() => expect(document.querySelectorAll('#rel-row-form-jsonref-options option')).toHaveLength(1))
    expect(document.querySelector('#rel-row-form-jsonref-options option')).toHaveAttribute('value', 'doc_1')

    const kvrefInput = screen.getByLabelText('cart_ref')
    expect(kvrefInput).toHaveAttribute('list', 'rel-row-form-kvref-options')
    await waitFor(() => expect(document.querySelectorAll('#rel-row-form-kvref-options option')).toHaveLength(2))

    // Kein <select> — die datalist schlägt nur vor, freie Eingabe bleibt möglich.
    fireEvent.change(jsonrefInput, { target: { value: 'doc_unlisted' } })
    expect(jsonrefInput).toHaveValue('doc_unlisted')

    // PK/nicht-Link-Spalten bekommen keine datalist.
    expect(screen.getByLabelText('id')).not.toHaveAttribute('list')
  })

  // "check links" öffnet seit spec 004 §4 einen Dialog per natives <dialog> + showModal() — in diesem jsdom
  // (25.0.1) nicht implementiert (nur die `open`-IDL-Property wird reflektiert), ein Klick hier würde crashen
  // (vgl. Explorer.test.tsx zum Create-Table-Assistenten). Der Report-Inhalt selbst ist <dialog>-frei in
  // DanglingReport.test.tsx gegen DanglingReportContent getestet; hier nur der Einstiegspunkt (sichtbar/versteckt).
  it('shows the "check links" entry point only when the table has link columns (KVREF/JSONREF/REFERENCES)', async () => {
    server.use(http.get(ROWS_URL, () => HttpResponse.json({ rows: [], row_count: 0, limit: 50, offset: 0, limit_applied: false })))
    await connectAndRender()
    await screen.findByText('no rows')

    expect(screen.getByRole('button', { name: 'check links' })).toBeInTheDocument()
  })

  it('hides "check links" for a table without any link columns', async () => {
    server.use(http.get(ROWS_URL, () => HttpResponse.json({ rows: [], row_count: 0, limit: 50, offset: 0, limit_applied: false })))
    await connectAndRender(`/data?engine=rel&table=${TABLE}`, [
      http.get(TABLE_URL, () =>
        HttpResponse.json({
          name: TABLE,
          created_at: 1,
          indexes: [],
          _links: { self: '', rows: '' },
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, autoincrement: true, unique: false },
            { name: 'total', type: 'REAL', nullable: false, primary_key: false, autoincrement: false, unique: false },
          ],
        }),
      ),
    ])
    await screen.findByText('no rows')

    expect(screen.queryByRole('button', { name: 'check links' })).not.toBeInTheDocument()
  })
})
