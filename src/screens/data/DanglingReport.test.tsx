import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../../api/schema'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { DanglingReportContent } from './DanglingReport'

type ColumnInfo = components['schemas']['ColumnInfo']

const ORIGIN = window.location.origin
const DOMAIN = 'shop'
const TABLE = 'orders'
const SQL_URL = `${ORIGIN}/store-api/rel/${DOMAIN}/sql`

const COLUMNS: ColumnInfo[] = [
  { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, autoincrement: true, unique: false },
  { name: 'cart_ref', type: 'KVREF', nullable: true, primary_key: false, autoincrement: false, unique: false },
  { name: 'customer_ref', type: 'JSONREF', nullable: true, primary_key: false, autoincrement: false, unique: false },
]

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function RouteProbe() {
  const location = useLocation()
  return <p data-testid="route-state">{location.pathname + location.search}</p>
}

function Harness({ columns, onClose }: { columns: ColumnInfo[]; onClose: () => void }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <DanglingReportContent apiClient={apiClient} domain={DOMAIN} table={TABLE} columns={columns} onClose={onClose} />
}

/** Rendert `DanglingReportContent` ohne die native `<dialog>`-Hülle (showModal() ist in diesem jsdom nicht implementiert). */
async function renderContent(onClose: () => void = () => {}, columns: ColumnInfo[] = COLUMNS) {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/data?engine=rel&table=orders']}>
        <Harness columns={columns} onClose={onClose} />
        <Routes>
          <Route path="/data" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('check links · orders')
  return result
}

afterEach(() => {
  act(() => disconnect())
})

describe('DanglingReportContent', () => {
  it('checks on mount (PK + link columns, LIMIT max_limit) and lists dangling rows as PK + column', async () => {
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        expect(await request.json()).toEqual({
          sql: 'SELECT id, cart_ref, customer_ref FROM orders LIMIT 10000',
          expand: ['cart_ref', 'customer_ref'],
        })
        return HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [
            [1, 'cart_1', 'doc_1'],
            [2, 'cart_missing', 'doc_1'],
          ],
          row_count: 2,
          limit_applied: false,
          expanded: {
            cart_ref: [
              { exists: true, value: 'x' },
              { exists: false, value: null },
            ],
            customer_ref: [
              { document: {}, exists: true },
              { document: {}, exists: true },
            ],
          },
        })
      }),
    )
    await renderContent()

    expect(await screen.findByText('2 · cart_ref')).toBeInTheDocument()
    expect(screen.queryByText('1 · cart_ref')).not.toBeInTheDocument()
    expect(screen.queryByText(/checked first/)).not.toBeInTheDocument()
  })

  // Server-Realität (live vermessen): REFERENCES-Auflösung ist die Zielzeile ohne `exists`; dangling ⇒ `null`;
  // NULL-Zellen liefern ebenfalls `null` und dürfen nie als dangling gemeldet werden.
  it('flags REFERENCES columns via explicit null resolutions, and never flags NULL cells', async () => {
    const fkColumns: ColumnInfo[] = [
      { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, autoincrement: true, unique: false },
      { name: 'gate', type: 'TEXT', nullable: true, primary_key: false, autoincrement: false, unique: false, references: 'doors_meta' },
    ]
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        expect(await request.json()).toEqual({ sql: 'SELECT id, gate FROM orders LIMIT 10000', expand: ['gate'] })
        return HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'gate', type: 'TEXT' },
          ],
          rows: [
            [1, 'gate_x'],
            [2, 'gate_y'],
            [3, null],
          ],
          row_count: 3,
          limit_applied: false,
          expanded: { gate: [{ code: 'gate_x' }, null, null] },
        })
      }),
    )
    await renderContent(() => {}, fkColumns)

    expect(await screen.findByText('2 · gate')).toBeInTheDocument()
    expect(screen.queryByText('1 · gate')).not.toBeInTheDocument()
    expect(screen.queryByText('3 · gate')).not.toBeInTheDocument()
  })

  it('notes the truncation honestly when the row limit was hit', async () => {
    server.use(
      http.post(SQL_URL, () =>
        HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [[1, 'cart_1', 'doc_1']],
          row_count: 1,
          limit_applied: true,
        }),
      ),
    )
    await renderContent()

    expect(await screen.findByText('checked first 1 rows')).toBeInTheDocument()
    expect(await screen.findByText('no dangling links')).toBeInTheDocument()
  })

  it('shows a calm "no dangling links" when the check finds nothing', async () => {
    server.use(
      http.post(SQL_URL, () =>
        HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [[1, 'cart_1', 'doc_1']],
          row_count: 1,
          limit_applied: false,
          expanded: {
            cart_ref: [{ exists: true, value: 'x' }],
            customer_ref: [{ document: {}, exists: true }],
          },
        }),
      ),
    )
    await renderContent()

    expect(await screen.findByText('no dangling links')).toBeInTheDocument()
  })

  it('jumps to the row via the existing filter-arrival URL pattern on entry click, and closes', async () => {
    const onClose = vi.fn()
    server.use(
      http.post(SQL_URL, () =>
        HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [[2, 'cart_missing', 'doc_1']],
          row_count: 1,
          limit_applied: false,
          expanded: {
            cart_ref: [{ exists: false, value: null }],
            customer_ref: [{ document: {}, exists: true }],
          },
        }),
      ),
    )
    await renderContent(onClose)

    fireEvent.click(await screen.findByRole('button', { name: '2 · cart_ref' }))

    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByTestId('route-state')).toHaveTextContent('/data?engine=rel&table=orders&filterCol=id&filterVal=2')
  })

  it('shows the request error inline (server message verbatim) when the check itself fails', async () => {
    server.use(http.post(SQL_URL, () => new HttpResponse('boom', { status: 500, headers: { 'Content-Type': 'text/plain' } })))
    await renderContent()

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('closes via the close button', async () => {
    const onClose = vi.fn()
    server.use(
      http.post(SQL_URL, () =>
        HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'cart_ref', type: 'KVREF' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [],
          row_count: 0,
          limit_applied: false,
        }),
      ),
    )
    await renderContent(onClose)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
