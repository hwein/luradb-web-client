import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import type { DomainSummary } from '../../shell/domains'
import { server } from '../../test/msw'
import { CreateTableForm } from './CreateTableModal'
import { resetSqlState, useSqlState } from './sqlStore'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function makeDomain(overrides?: Partial<DomainSummary['engines']>): DomainSummary {
  return { name: 'shop', engines: { kv: true, json: { state: 'active' }, rel: { state: 'active' }, ...overrides } }
}

function tablesHandler(names: string[]) {
  return http.get(`${ORIGIN}/store-api/rel/shop/tables`, () => HttpResponse.json(names.map((name) => ({ name, _links: { self: '', rows: '' } }))))
}

function viewsHandler(names: string[]) {
  return http.get(`${ORIGIN}/store-api/rel/shop/views`, () => HttpResponse.json(names.map((name) => ({ name, sql: 'SELECT 1', created_at: 1 }))))
}

function pkColumn(name: string, type: string) {
  return { name, type, nullable: false, primary_key: true, unique: false, autoincrement: type === 'INTEGER' }
}

function tableDetailHandler(table: string, columns: ReturnType<typeof pkColumn>[]) {
  return http.get(`${ORIGIN}/store-api/rel/shop/tables/${table}`, () =>
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

function Harness({ domain, onClose }: { domain: DomainSummary; onClose: () => void }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <CreateTableForm domain={domain} apiClient={apiClient} onClose={onClose} />
}

async function renderForm(domain: DomainSummary, onClose: () => void = () => {}) {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/sql']}>
        <Harness domain={domain} onClose={onClose} />
        <Routes>
          <Route path="/sql" element={<SqlRouteProbe />} />
          <Route path="/docs" element={<DocsRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('create table · shop')
  return result
}

afterEach(() => {
  act(() => disconnect())
  resetSqlState()
})

describe('CreateTableForm', () => {
  it('starts with the seeded id/INTEGER primary-key column and insert disabled (empty table name)', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    expect(screen.getByLabelText('column 1 name')).toHaveValue('id')
    expect(screen.getByLabelText('column 1 type')).toHaveValue('INTEGER')
    expect(screen.getByLabelText('primary key: column 1')).toBeChecked()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'remove column 1' })).toBeDisabled()
  })

  it('"+ add column" appends a new blank TEXT row', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))

    expect(screen.getByLabelText('column 2 name')).toHaveValue('')
    expect(screen.getByLabelText('column 2 type')).toHaveValue('TEXT')
    expect(screen.getByRole('button', { name: 'remove column 1' })).not.toBeDisabled()
  })

  it('removes a column row and reassigns the primary key when the removed row held it', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'name' } })

    fireEvent.click(screen.getByRole('button', { name: 'remove column 1' }))

    expect(screen.queryByLabelText('column 2 name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('column 1 name')).toHaveValue('name')
    expect(screen.getByLabelText('primary key: column 1')).toBeChecked()
  })

  it('shows an inline error when the PK column\'s type moves away from INTEGER/TEXT, and clears it once another column becomes PK', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'name' } })

    fireEvent.change(screen.getByLabelText('column 1 type'), { target: { value: 'REAL' } })

    expect(await screen.findByText(/primary key must be INTEGER or TEXT/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('primary key: column 2'))

    expect(screen.queryByText(/primary key must be INTEGER or TEXT/)).not.toBeInTheDocument()
  })

  it('only allows AUTOINCREMENT while the PK column is INTEGER, and clears the flag on a type change', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    expect(screen.getByLabelText('autoincrement for column 1')).not.toBeDisabled()
    fireEvent.click(screen.getByLabelText('autoincrement for column 1'))

    fireEvent.change(screen.getByLabelText('column 1 type'), { target: { value: 'TEXT' } })

    expect(screen.getByLabelText('autoincrement for column 1')).toBeDisabled()
    expect(screen.getByLabelText('autoincrement for column 1')).not.toBeChecked()
  })

  it('requires a default value once "default" is enabled on a non-TEXT column, blocking insert until provided', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 't' } })
    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'amount' } })
    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'INTEGER' } })
    fireEvent.click(screen.getByLabelText('default for column 2'))

    expect(await screen.findByText('default value required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('default value for column 2'), { target: { value: '0' } })

    expect(screen.queryByText('default value required')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).not.toBeDisabled()
  })

  it('shows the KVREF hint with a docs link, and disables JSONREF when the domain has no json engine', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain({ json: undefined }))

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'KVREF' } })

    expect(await screen.findByText(/points to a kv key in this domain/)).toBeInTheDocument()

    const typeSelect = screen.getByLabelText('column 2 type')
    const jsonOption = within(typeSelect).getByRole('option', { name: 'JSONREF' })
    expect(jsonOption).toBeDisabled()
    expect(jsonOption.getAttribute('title')).toMatch(/json engine not enabled/)

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(await screen.findByTestId('docs-route-state')).toHaveTextContent('/docs')
  })

  it('initializes a BOOLEAN default to true the moment "default" is checked, without requiring the select to be touched', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'active' } })
    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'BOOLEAN' } })
    fireEvent.click(screen.getByLabelText('default for column 2'))

    expect(screen.getByLabelText('default value for column 2')).toHaveValue('true')

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 't' } })
    fireEvent.click(screen.getByRole('button', { name: 'insert into editor' }))

    expect(screen.getByTestId('sql-route-state').textContent).toBe(
      '/sql · CREATE TABLE t (\n  id INTEGER PRIMARY KEY,\n  active BOOLEAN DEFAULT TRUE\n);',
    )
  })

  it('offers only reference targets whose primary-key type matches the column type', async () => {
    server.use(
      tablesHandler(['customers', 'warehouses']),
      viewsHandler([]),
      tableDetailHandler('customers', [pkColumn('id', 'TEXT')]),
      tableDetailHandler('warehouses', [pkColumn('id', 'INTEGER')]),
    )
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'ref_id' } })
    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'INTEGER' } })

    const intRefSelect = await screen.findByLabelText('references for column 2')
    expect(within(intRefSelect).getByRole('option', { name: 'warehouses' })).toBeInTheDocument()
    expect(within(intRefSelect).queryByRole('option', { name: 'customers' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'TEXT' } })

    const textRefSelect = await screen.findByLabelText('references for column 2')
    expect(within(textRefSelect).getByRole('option', { name: 'customers' })).toBeInTheDocument()
    expect(within(textRefSelect).queryByRole('option', { name: 'warehouses' })).not.toBeInTheDocument()
  })

  it('hides the references control once no table has a matching primary-key type', async () => {
    server.use(tablesHandler(['customers']), viewsHandler([]), tableDetailHandler('customers', [pkColumn('id', 'TEXT')]))
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'ref_id' } })

    // column 2 defaults to TEXT — confirms the customers/TEXT-pk detail query has resolved before the negative check.
    await screen.findByLabelText('references for column 2')

    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'INTEGER' } })

    expect(screen.queryByLabelText('references for column 2')).not.toBeInTheDocument()
  })

  it('rejects a reserved keyword as the table name', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'select' } })

    expect(await screen.findByText(/reserved word/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
  })

  it('rejects a duplicate column name within the list, flagging every row that shares it', async () => {
    server.use(tablesHandler([]), viewsHandler([]))
    await renderForm(makeDomain())

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'id' } })

    expect(await screen.findAllByText(/duplicate column name "id"/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
  })

  it('rejects a table name colliding with an existing view (shared rel namespace)', async () => {
    server.use(tablesHandler([]), viewsHandler(['v_paid']))
    await renderForm(makeDomain())

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'v_paid' } })

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'insert into editor' })).toBeDisabled()
  })

  it('inserts the generated CREATE TABLE statement into the SQL editor, navigates to /sql, and closes', async () => {
    server.use(
      tablesHandler(['customers', 'warehouses']),
      viewsHandler([]),
      tableDetailHandler('customers', [pkColumn('id', 'TEXT')]),
      tableDetailHandler('warehouses', [pkColumn('id', 'INTEGER')]),
    )
    const onClose = vi.fn()
    await renderForm(makeDomain(), onClose)

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'ORDERS' } })
    fireEvent.click(screen.getByLabelText('autoincrement for column 1'))

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 2 name'), { target: { value: 'total' } })
    fireEvent.change(screen.getByLabelText('column 2 type'), { target: { value: 'REAL' } })
    fireEvent.click(screen.getByLabelText('not null for column 2'))

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 3 name'), { target: { value: 'warehouse_id' } })
    fireEvent.change(screen.getByLabelText('column 3 type'), { target: { value: 'INTEGER' } })
    const refSelect = await screen.findByLabelText('references for column 3')
    fireEvent.change(refSelect, { target: { value: 'warehouses' } })

    fireEvent.click(screen.getByRole('button', { name: '+ add column' }))
    fireEvent.change(screen.getByLabelText('column 4 name'), { target: { value: 'status' } })
    fireEvent.click(screen.getByLabelText('unique for column 4'))
    fireEvent.click(screen.getByLabelText('default for column 4'))
    fireEvent.change(screen.getByLabelText('default value for column 4'), { target: { value: 'pending' } })

    const insertButton = screen.getByRole('button', { name: 'insert into editor' })
    expect(insertButton).not.toBeDisabled()
    fireEvent.click(insertButton)

    expect(screen.getByTestId('sql-route-state').textContent).toBe(
      "/sql · CREATE TABLE orders (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  total REAL NOT NULL,\n  warehouse_id INTEGER REFERENCES warehouses,\n  status TEXT UNIQUE DEFAULT 'pending'\n);",
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
