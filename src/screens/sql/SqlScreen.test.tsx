import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { server } from '../../test/msw'
import { SqlScreen } from './SqlScreen'
import { resetSqlState } from './sqlStore'

const ORIGIN = window.location.origin
const SQL_URL = `${ORIGIN}/store-api/rel/shop/sql`

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
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([{ name: 'shop', state: 'active', created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/rel/shop/tables`, () => HttpResponse.json([{ name: 'orders', _links: { self: '', rows: '' } }])),
    http.get(`${ORIGIN}/store-api/rel/shop/tables/orders`, () =>
      HttpResponse.json({
        name: 'orders',
        created_at: 1,
        indexes: [],
        _links: { self: '', rows: '' },
        columns: [
          { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, unique: false, autoincrement: true },
          { name: 'customer_ref', type: 'KVREF', nullable: true, primary_key: false, unique: false, autoincrement: false },
          {
            name: 'warehouse_id',
            type: 'INTEGER',
            nullable: true,
            primary_key: false,
            unique: false,
            autoincrement: false,
            references: 'warehouses',
          },
        ],
      }),
    ),
  ]
}

async function connectAndRender(state?: unknown) {
  server.use(...baseHandlers())
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/sql', state }]}>
        <SelectedDomainProvider>
          <SqlScreen />
        </SelectedDomainProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function findEnabledRun(): Promise<HTMLElement> {
  const run = await screen.findByRole('button', { name: '▶ Run' })
  await waitFor(() => expect(run).toBeEnabled())
  return run
}

beforeEach(() => {
  localStorage.clear()
  resetSqlState()
})

afterEach(() => {
  act(() => disconnect())
})

describe('SqlScreen', () => {
  it('seeds a tab from the docs "try in the console" router state and runs it', async () => {
    let requestBody: unknown
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'customer_ref', type: 'KVREF' },
          ],
          rows: [
            [1042, 'cus_8102'],
            [1043, 'cus_8103'],
          ],
          row_count: 2,
          limit_applied: false,
        })
      }),
    )
    const { container } = await connectAndRender({ insertQuery: 'SELECT id, customer_ref FROM orders' })

    fireEvent.click(await findEnabledRun())

    expect(await screen.findByRole('columnheader', { name: 'customer_ref' })).toBeInTheDocument()
    expect(await screen.findByText('cus_8102')).toBeInTheDocument()
    const meta = container.querySelector('.sql-results__meta')?.textContent ?? ''
    expect(meta).toContain('2 rows')
    expect(meta).toContain('POST /store-api/rel/shop/sql')
    expect(screen.getByRole('button', { name: 'export ndjson ↓' })).toBeInTheDocument()
    expect(requestBody).toEqual({ sql: 'SELECT id, customer_ref FROM orders' })
  })

  it('adds a KVREF column chip and sends it as expand in the request body', async () => {
    let requestBody: unknown
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ columns: [{ name: 'id', type: 'INTEGER' }], rows: [[1]], row_count: 1, limit_applied: false })
      }),
    )
    await connectAndRender({ insertQuery: 'SELECT id, customer_ref FROM orders' })

    fireEvent.click(await screen.findByRole('button', { name: 'add expand customer_ref' }))
    expect(screen.getByRole('button', { name: 'remove expand customer_ref' })).toBeInTheDocument()

    // REFERENCES-Spalten bekommen denselben Expand-Chip wie KVREF/JSONREF (spec sql/002 §9).
    fireEvent.click(await screen.findByRole('button', { name: 'add expand warehouse_id' }))
    expect(screen.getByRole('button', { name: 'remove expand warehouse_id' })).toBeInTheDocument()

    fireEvent.click(await findEnabledRun())

    await waitFor(() =>
      expect(requestBody).toEqual({ sql: 'SELECT id, customer_ref FROM orders', expand: ['customer_ref', 'warehouse_id'] }),
    )
  })

  it('renders a dangling expanded link muted with a docs link that opens the split', async () => {
    server.use(
      http.post(SQL_URL, () =>
        HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'customer_ref', type: 'KVREF' },
          ],
          rows: [[1044, 'cus_9911']],
          row_count: 1,
          limit_applied: false,
          expanded: { customer_ref: [{ exists: false }] },
        }),
      ),
    )
    await connectAndRender({ insertQuery: 'SELECT id, customer_ref FROM orders' })

    fireEvent.click(await findEnabledRun())

    expect(await screen.findByRole('columnheader', { name: '_expanded.customer_ref' })).toBeInTheDocument()
    expect(screen.getByText(/dangling link/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(await screen.findByLabelText('search docs')).toBeInTheDocument()
  })

  it('shows a DDL confirmation for schema statements', async () => {
    server.use(http.post(SQL_URL, () => HttpResponse.json({ ok: true })))
    await connectAndRender({ insertQuery: 'CREATE TABLE t (id INTEGER PRIMARY KEY)' })

    fireEvent.click(await findEnabledRun())

    expect(await screen.findByText('ok · CREATE TABLE')).toBeInTheDocument()
  })

  it('shows a DML confirmation with affected rows and last_pk', async () => {
    server.use(http.post(SQL_URL, () => HttpResponse.json({ affected: 2, last_pk: 7 })))
    await connectAndRender({ insertQuery: 'INSERT INTO orders (id) VALUES (1)' })

    fireEvent.click(await findEnabledRun())

    expect(await screen.findByText('2 rows affected · last_pk 7')).toBeInTheDocument()
  })

  it('renders a SQL error with the plain-text server message and a syntax docs link', async () => {
    server.use(
      http.post(SQL_URL, () =>
        HttpResponse.text('syntax error at position 0: expected a statement', { status: 400 }),
      ),
    )
    await connectAndRender({ insertQuery: 'SELEKT bad' })

    fireEvent.click(await findEnabledRun())

    expect(await screen.findByText(/syntax error at position 0/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '? syntax' })).toBeInTheDocument()
  })

  it('save as view (⌘S) wraps the editor SQL in CREATE VIEW and confirms', async () => {
    let requestBody: unknown
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const { container } = await connectAndRender({ insertQuery: 'SELECT * FROM orders' })
    await findEnabledRun()

    const content = container.querySelector('.cm-content')
    expect(content).not.toBeNull()
    fireEvent.keyDown(content as Element, { key: 's', ctrlKey: true })

    const nameInput = await screen.findByLabelText('view name')
    fireEvent.change(nameInput, { target: { value: 'paid_orders' } })
    const form = nameInput.closest('form')
    fireEvent.submit(form as Element)

    await waitFor(() => expect(requestBody).toEqual({ sql: 'CREATE VIEW paid_orders AS SELECT * FROM orders' }))
    expect(await screen.findByText('ok · CREATE VIEW')).toBeInTheDocument()
  })

  it('persists a newly opened tab to localStorage', async () => {
    server.use(http.post(SQL_URL, () => HttpResponse.json({ ok: true })))
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'new tab' }))

    await waitFor(() => {
      const raw = localStorage.getItem('luradb.sqlTabs')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw ?? '{}') as { tabs?: unknown[] }
      expect(parsed.tabs).toHaveLength(2)
    })
  })

  it('sends the params field as a JSON array for a ?-statement', async () => {
    let requestBody: unknown
    server.use(
      http.post(SQL_URL, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ columns: [{ name: 'id', type: 'INTEGER' }], rows: [[1042]], row_count: 1, limit_applied: false })
      }),
    )
    await connectAndRender({ insertQuery: 'SELECT id FROM orders WHERE status = ?' })

    fireEvent.change(await screen.findByLabelText('params'), { target: { value: '["paid"]' } })
    fireEvent.click(await findEnabledRun())

    await waitFor(() => expect(requestBody).toEqual({ sql: 'SELECT id FROM orders WHERE status = ?', params: ['paid'] }))
  })

  it('locks Run and shows an inline error when params does not parse as a JSON array', async () => {
    await connectAndRender({ insertQuery: 'SELECT 1' })
    const run = await findEnabledRun()

    fireEvent.change(await screen.findByLabelText('params'), { target: { value: '{}' } })

    expect(await screen.findByText('params must be a JSON array')).toBeInTheDocument()
    expect(run).toBeDisabled()
  })

  it('renders a server 400 for a wrong params count the same way as other SQL errors', async () => {
    server.use(http.post(SQL_URL, () => HttpResponse.text('parameter count mismatch: expected 1, got 2', { status: 400 })))
    await connectAndRender({ insertQuery: 'SELECT id FROM orders WHERE status = ?' })

    fireEvent.change(await screen.findByLabelText('params'), { target: { value: '["paid", "extra"]' } })
    fireEvent.click(await findEnabledRun())

    expect(await screen.findByText(/parameter count mismatch/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '? syntax' })).toBeInTheDocument()
  })
})
