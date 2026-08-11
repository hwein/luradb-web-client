import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import type { components } from '../../api/schema'
import type { DomainSummary } from '../../shell/domains'
import { server } from '../../test/msw'
import { AlterTableForm } from './AlterTableModal'
import { resetSqlState, useSqlState } from './sqlStore'

type TableDetail = components['schemas']['TableDetail']

const ORIGIN = window.location.origin
const DOMAIN = 'shop'
const TABLE = 'orders'

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function makeDomain(overrides?: Partial<DomainSummary['engines']>): DomainSummary {
  return { name: DOMAIN, engines: { kv: true, json: { state: 'active' }, rel: { state: 'active' }, ...overrides } }
}

/** id (PK, INTEGER) · total (REAL, plain) · label (TEXT, uniquely indexed — not droppable). */
function schema(overrides?: Partial<TableDetail>): TableDetail {
  return {
    name: TABLE,
    created_at: 1,
    _links: { self: '', rows: '' },
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, autoincrement: true, unique: false },
      { name: 'total', type: 'REAL', nullable: false, primary_key: false, autoincrement: false, unique: false },
      { name: 'label', type: 'TEXT', nullable: true, primary_key: false, autoincrement: false, unique: false },
    ],
    indexes: [{ name: 'orders_label_key', column: 'label', unique: true }],
    ...overrides,
  }
}

function tablesHandler(names: string[]) {
  return http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json(names.map((name) => ({ name, _links: { self: '', rows: '' } }))))
}

function viewsHandler(names: string[]) {
  return http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/views`, () => HttpResponse.json(names.map((name) => ({ name, sql: 'SELECT 1', created_at: 1 }))))
}

function pkColumn(name: string, type: string) {
  return { name, type, nullable: false, primary_key: true, unique: false, autoincrement: type === 'INTEGER' }
}

function tableDetailHandler(table: string, columns: ReturnType<typeof pkColumn>[]) {
  return http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables/${table}`, () =>
    HttpResponse.json({ name: table, created_at: 1, indexes: [], _links: { self: '', rows: '' }, columns }),
  )
}

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

function DocsRouteProbe() {
  const location = useLocation()
  return <p data-testid="docs-route-state">{location.pathname}</p>
}

function Harness({
  domain,
  table,
  tableSchema,
  onClose,
}: {
  domain: DomainSummary
  table: string
  tableSchema: TableDetail
  onClose: () => void
}) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <AlterTableForm domain={domain} apiClient={apiClient} table={table} schema={tableSchema} onClose={onClose} />
}

async function renderForm(domain: DomainSummary, table: string, tableSchema: TableDetail, onClose: () => void = () => {}) {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/sql']}>
        <Harness domain={domain} table={table} tableSchema={tableSchema} onClose={onClose} />
        <Routes>
          <Route path="/sql" element={<SqlRouteProbe />} />
          <Route path="/docs" element={<DocsRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText(`alter table · ${table}`)
  return result
}

afterEach(() => {
  act(() => disconnect())
  resetSqlState()
})

describe('AlterTableForm', () => {
  it('starts in "add column" mode with insert disabled (empty name) and the no-PK/AUTOINCREMENT/UNIQUE hint visible', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    expect(screen.getByRole('radio', { name: 'add column' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
    expect(screen.getByText(/no PRIMARY KEY, AUTOINCREMENT, or UNIQUE here/)).toBeInTheDocument()
  })

  it('add column: rejects a duplicate name against the current schema', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.change(screen.getByLabelText('column name'), { target: { value: 'total' } })

    expect(await screen.findByText(/duplicate column name "total"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
  })

  it('add column: "not null" stays locked until a literal default is set, then generates NOT NULL DEFAULT and completes the flow', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    const onClose = vi.fn()
    await renderForm(makeDomain(), TABLE, schema(), onClose)

    fireEvent.change(screen.getByLabelText('column name'), { target: { value: 'amount' } })
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'INTEGER' } })

    expect(screen.getByLabelText('not null')).toBeDisabled()
    expect(screen.getByLabelText('not null')).toHaveAttribute('title', expect.stringContaining('literal default'))

    fireEvent.click(screen.getByLabelText('default'))
    expect(await screen.findByText('default value required')).toBeInTheDocument()
    expect(screen.getByLabelText('not null')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('default value'), { target: { value: '5' } })
    expect(screen.queryByText('default value required')).not.toBeInTheDocument()
    expect(screen.getByLabelText('not null')).not.toBeDisabled()

    fireEvent.click(screen.getByLabelText('not null'))
    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))

    expect(screen.getByTestId('sql-route-state').textContent).toBe('/sql · ALTER TABLE orders ADD COLUMN amount INTEGER NOT NULL DEFAULT 5;')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('add column: DEFAULT CURRENT_TIMESTAMP does not count as literal — "not null" stays locked', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.change(screen.getByLabelText('column name'), { target: { value: 'created_at' } })
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'TIMESTAMP' } })
    fireEvent.click(screen.getByLabelText('default'))
    fireEvent.click(screen.getByLabelText('default current_timestamp'))

    expect(screen.queryByText('default value required')).not.toBeInTheDocument()
    expect(screen.getByLabelText('not null')).toBeDisabled()
    expect(screen.getByLabelText('not null')).toHaveAttribute('title', expect.stringContaining('CURRENT_TIMESTAMP does not count'))

    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))
    expect(screen.getByTestId('sql-route-state').textContent).toBe(
      '/sql · ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;',
    )
  })

  it('add column: shows the KVREF hint with a docs link, and disables JSONREF (reason names ADD COLUMN) when the domain has no json engine', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain({ json: undefined }), TABLE, schema())

    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'KVREF' } })
    expect(await screen.findByText(/points to a kv key in this domain/)).toBeInTheDocument()

    const typeSelect = screen.getByLabelText('type')
    const jsonOption = within(typeSelect).getByRole('option', { name: 'JSONREF' })
    expect(jsonOption).toBeDisabled()
    expect(jsonOption.getAttribute('title')).toMatch(/json engine not enabled/)
    expect(jsonOption.getAttribute('title')).toMatch(/ADD COLUMN would fail with 409/)

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(await screen.findByTestId('docs-route-state')).toHaveTextContent('/docs')
  })

  it('add column: offers REFERENCES targets filtered by matching primary-key type', async () => {
    server.use(
      tablesHandler([TABLE, 'warehouses', 'customers']),
      viewsHandler([]),
      tableDetailHandler(TABLE, [pkColumn('id', 'INTEGER')]),
      tableDetailHandler('warehouses', [pkColumn('id', 'INTEGER')]),
      tableDetailHandler('customers', [pkColumn('id', 'TEXT')]),
    )
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.change(screen.getByLabelText('column name'), { target: { value: 'warehouse_id' } })
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'INTEGER' } })

    const refSelect = await screen.findByLabelText('references')
    expect(within(refSelect).getByRole('option', { name: 'warehouses' })).toBeInTheDocument()
    expect(within(refSelect).queryByRole('option', { name: 'customers' })).not.toBeInTheDocument()

    fireEvent.change(refSelect, { target: { value: 'warehouses' } })
    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))

    expect(screen.getByTestId('sql-route-state').textContent).toBe(
      '/sql · ALTER TABLE orders ADD COLUMN warehouse_id INTEGER REFERENCES warehouses;',
    )
  })

  it('drop column: disables the PK column and the uniquely-indexed column with a reason in the title, leaves a plain column selectable', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.click(screen.getByRole('radio', { name: 'drop column' }))

    const select = screen.getByLabelText('column to drop')
    const idOption = within(select).getByRole('option', { name: 'id' })
    expect(idOption).toBeDisabled()
    expect(idOption).toHaveAttribute('title', 'primary key')

    const labelOption = within(select).getByRole('option', { name: 'label' })
    expect(labelOption).toBeDisabled()
    expect(labelOption).toHaveAttribute('title', 'indexed by orders_label_key')

    const totalOption = within(select).getByRole('option', { name: 'total' })
    expect(totalOption).not.toBeDisabled()
    expect(select).toHaveValue('total')
    expect(screen.getByText(/dropping a column can break views/)).toBeInTheDocument()
  })

  it('drop column: generates the statement and completes the insert flow', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.click(screen.getByRole('radio', { name: 'drop column' }))
    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))

    expect(screen.getByTestId('sql-route-state').textContent).toBe('/sql · ALTER TABLE orders DROP COLUMN total;')
  })

  it('drop column: blocks insert with an explanatory message when every column is the primary key or indexed', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    const onlyPk = schema({
      columns: [{ name: 'id', type: 'INTEGER', nullable: false, primary_key: true, autoincrement: true, unique: false }],
      indexes: [],
    })
    await renderForm(makeDomain(), TABLE, onlyPk)

    fireEvent.click(screen.getByRole('radio', { name: 'drop column' }))

    expect(await screen.findByText(/no column can be dropped/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
  })

  it('rename column: rejects a reserved keyword and a name colliding with another column', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.click(screen.getByRole('radio', { name: 'rename column' }))
    fireEvent.change(screen.getByLabelText('new column name'), { target: { value: 'select' } })

    expect(await screen.findByText(/reserved word/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('new column name'), { target: { value: 'total' } })

    expect(await screen.findByText(/duplicate column name "total"/)).toBeInTheDocument()
  })

  it('rename column: generates the statement and completes the insert flow', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.click(screen.getByRole('radio', { name: 'rename column' }))
    fireEvent.change(screen.getByLabelText('column to rename'), { target: { value: 'label' } })
    fireEvent.change(screen.getByLabelText('new column name'), { target: { value: 'note' } })
    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))

    expect(screen.getByTestId('sql-route-state').textContent).toBe('/sql · ALTER TABLE orders RENAME COLUMN label TO note;')
  })

  it('rename table: rejects a name colliding with an existing table or view (shared rel namespace)', async () => {
    server.use(
      tablesHandler([TABLE, 'archive']),
      viewsHandler(['v_paid']),
      tableDetailHandler(TABLE, [pkColumn('id', 'INTEGER')]),
      tableDetailHandler('archive', [pkColumn('id', 'INTEGER')]),
    )
    await renderForm(makeDomain(), TABLE, schema())

    fireEvent.click(screen.getByRole('radio', { name: 'rename table' }))
    fireEvent.change(screen.getByLabelText('new table name'), { target: { value: 'archive' } })

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('new table name'), { target: { value: 'v_paid' } })

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByText(/views that reference this table may keep the old name/)).toBeInTheDocument()
  })

  it('rename table: generates the statement, inserts into the editor, navigates to /sql, and closes', async () => {
    server.use(tablesHandler([TABLE]), viewsHandler([]), tableDetailHandler(TABLE, [pkColumn('id', 'INTEGER')]))
    const onClose = vi.fn()
    await renderForm(makeDomain(), TABLE, schema(), onClose)

    fireEvent.click(screen.getByRole('radio', { name: 'rename table' }))
    fireEvent.change(screen.getByLabelText('new table name'), { target: { value: 'purchases' } })
    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))

    expect(screen.getByTestId('sql-route-state').textContent).toBe('/sql · ALTER TABLE orders RENAME TO purchases;')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
