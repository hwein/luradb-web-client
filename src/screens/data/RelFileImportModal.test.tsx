import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { RelFileImportForm } from './RelFileImportModal'

const ORIGIN = window.location.origin
const DOMAIN = 'shop'

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function Harness({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <RelFileImportForm domain={DOMAIN} apiClient={apiClient} onClose={onClose} />
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

/** Renders `RelFileImportForm` without the native `<dialog>` shell (showModal() is not implemented in this jsdom). */
async function renderForm(onClose: () => void = () => {}, existing: { views?: string[] } = {}) {
  server.use(
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
    http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/views`, () =>
      HttpResponse.json((existing.views ?? []).map((name) => ({ name, sql: 'SELECT 1', created_at: 1 }))),
    ),
  )
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Harness onClose={onClose} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('create table from file · shop')
  return { queryClient }
}

const FROM_FILE_URL = `${ORIGIN}/store-api/rel/${DOMAIN}/tables/from-file`

type ImportBody = {
  table: string
  columns: { name: string; type: string; primary_key: boolean; source_header?: string }[]
  imported: number
  failed: number
  errors: { row: number; error: string }[]
}

function peopleBody(overrides: Partial<ImportBody> = {}): ImportBody {
  return {
    table: 'people',
    columns: [
      { name: '_row', type: 'INTEGER', primary_key: true },
      { name: 'first_name', type: 'TEXT', primary_key: false, source_header: 'First Name' },
      { name: 'city', type: 'TEXT', primary_key: false, source_header: 'city' },
    ],
    imported: 2,
    failed: 0,
    errors: [],
    ...overrides,
  }
}

/** Answers the import POST with 201 and records the requested URLs. */
function importHandler(body: ImportBody, urls: URL[] = []) {
  server.use(
    http.post(FROM_FILE_URL, ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json(body, { status: 201 })
    }),
  )
  return urls
}

async function importPeople(body: ImportBody = peopleBody()) {
  const urls = importHandler(body)
  chooseFile('First Name,city\nann,x\nbob,y\n', 'people.csv')
  await screen.findByText('people.csv · 28 B')
  await waitForRead()
  fireEvent.click(screen.getByRole('button', { name: 'import' }))
  await screen.findByText(`table ${body.table} created`)
  return urls
}

function chooseFile(content: BlobPart, name: string): void {
  fireEvent.change(screen.getByLabelText('choose file…'), { target: { files: [new File([content], name)] } })
}

/** Waits until the chosen file has been read and import is enabled. */
async function waitForRead(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled())
}

function formatButton(name: 'csv' | 'tsv'): HTMLElement {
  return screen.getByRole('button', { name })
}

const NO_PK = '(none — the server adds an integer column _row)'
const ROW_HINT = '_row is not autoincrement — later row inserts must supply it'
const FIRST_LINE_HINT = 'columns become col_1 … col_n and the first line is imported as data'

function pkSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('primary key')
}

function pkOptions(): { label: string; value: string }[] {
  return Array.from(pkSelect().options, (option) => ({ label: option.text, value: option.value }))
}

afterEach(() => {
  act(() => disconnect())
})

describe('RelFileImportForm', () => {
  it('shows the title and the excel/ods hint, keeps import disabled without a file, and closes via the close button', async () => {
    const onClose = vi.fn()
    await renderForm(onClose)

    expect(screen.getByText('excel/ods? save it as csv in your spreadsheet app first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the file name and size and preselects the format from the extension once a file is chosen', async () => {
    await renderForm()
    expect(formatButton('csv')).toHaveAttribute('aria-pressed', 'true')

    chooseFile('a\tb\n1\t2\n', 'people.tsv')

    expect(await screen.findByText('people.tsv · 8 B')).toBeInTheDocument()
    expect(formatButton('tsv')).toHaveAttribute('aria-pressed', 'true')
    expect(formatButton('csv')).toHaveAttribute('aria-pressed', 'false')
    await waitForRead()
  })

  it('keeps import disabled until the chosen file has been read', async () => {
    await renderForm()
    chooseFile('a,b\n1,2\n', 'people.csv')

    expect(screen.getByText('people.csv · 8 B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()
    await waitForRead()
  })

  it('ignores a file that finishes reading after another file was chosen', async () => {
    await renderForm()
    const bodies: string[] = []
    server.use(
      http.post(FROM_FILE_URL, async ({ request }) => {
        bodies.push(await request.text())
        return HttpResponse.json(peopleBody({ table: 'second' }), { status: 201 })
      }),
    )
    const readAsText = FileReader.prototype.readAsText
    let releaseFirst: () => void = () => {}
    const spy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, blob: Blob) {
      if (blob instanceof File && blob.name === 'first.csv') releaseFirst = () => readAsText.call(this, blob)
      else readAsText.call(this, blob)
    })
    try {
      chooseFile('a,b\n1,2\n', 'first.csv')
      chooseFile('x,y\n3,4\n', 'second.csv')
      await screen.findByRole('option', { name: 'x' })

      releaseFirst()
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

      expect(pkOptions().map((option) => option.label)).toEqual([NO_PK, 'x', 'y'])
      fireEvent.click(screen.getByRole('button', { name: 'import' }))
      await screen.findByText('table second created')
      expect(bodies).toEqual(['x,y\n3,4\n'])
    } finally {
      spy.mockRestore()
    }
  })

  it('shows a read error inline, keeps import disabled, and recovers when a file is chosen again', async () => {
    await renderForm()
    const readError = 'could not read the file — choose it again'
    const spy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      setTimeout(() => this.dispatchEvent(new ProgressEvent('error')))
    })
    try {
      chooseFile('a,b\n1,2\n', 'broken.csv')
      expect(await screen.findByText(readError)).toHaveClass('rfi__error')
      expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()
    } finally {
      spy.mockRestore()
    }

    chooseFile('a,b\n1,2\n', 'people.csv')
    await screen.findByRole('option', { name: 'a' })
    expect(screen.queryByText(readError)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled()
  })

  it('keeps a manually changed format until a new file is chosen', async () => {
    await renderForm()
    chooseFile('a,b\n', 'one.csv')
    await screen.findByText('one.csv · 4 B')

    fireEvent.click(formatButton('tsv'))
    expect(formatButton('tsv')).toHaveAttribute('aria-pressed', 'true')

    chooseFile('a,b\n1,2\n', 'two.csv')
    await screen.findByText('two.csv · 8 B')
    expect(formatButton('csv')).toHaveAttribute('aria-pressed', 'true')
    expect(formatButton('tsv')).toHaveAttribute('aria-pressed', 'false')
  })

  it('warns without blocking when the file text contains the replacement character', async () => {
    await renderForm()
    const warning = 'not valid utf-8 — characters were replaced; save the file as utf-8 and retry'
    chooseFile('id,name\n1,ok\n', 'clean.csv')
    await screen.findByText('clean.csv · 13 B')
    expect(screen.queryByText(warning)).not.toBeInTheDocument()

    chooseFile(new Uint8Array([0x69, 0x64, 0x0a, 0xff, 0x0a]), 'latin1.csv')

    expect(await screen.findByText(warning)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled()
  })

  it('prefills the table name from the file name and forces lowercase input', async () => {
    await renderForm()
    const input = screen.getByLabelText('table name')
    expect(input).toHaveValue('')

    chooseFile('a,b\n', 'Order Export.csv')
    await screen.findByText('Order Export.csv · 4 B')
    expect(input).toHaveValue('order_export')

    fireEvent.change(input, { target: { value: 'My_Table' } })
    expect(input).toHaveValue('my_table')
  })

  it('rejects the reserved word select as the table name and keeps import disabled', async () => {
    await renderForm()
    chooseFile('a,b\n', 'select.csv')
    await screen.findByText('select.csv · 4 B')
    await screen.findByRole('option', { name: 'a' })

    expect(screen.getByLabelText('table name')).toHaveValue('select')
    expect(screen.getByText('"select" is a reserved word')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()
  })

  it('rejects a table name colliding with an existing view (shared rel namespace)', async () => {
    await renderForm(() => {}, { views: ['people'] })
    chooseFile('a,b\n', 'people.csv')
    await screen.findByText('people.csv · 4 B')
    await screen.findByRole('option', { name: 'a' })

    expect(await screen.findByText('"people" already exists (table or view)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'people2' } })
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled()
  })

  it('rejects a table name with invalid characters', async () => {
    await renderForm()
    chooseFile('a,b\n', 'people.csv')
    await screen.findByText('people.csv · 4 B')
    await screen.findByRole('option', { name: 'a' })

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'my table' } })
    expect(screen.getByText('must be lowercase, start with a letter or _, only [a-z0-9_], max 50 chars')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: '1abc' } })
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()
  })

  it('offers the normalized header names as primary key candidates and appends the source header where it differs', async () => {
    await renderForm()
    expect(screen.getByLabelText('first line is a header')).toBeChecked()
    expect(pkOptions()).toEqual([{ label: NO_PK, value: '' }])

    chooseFile('First Name,id,ID\nann,1,2\n', 'people.csv')
    await screen.findByRole('option', { name: 'id' })

    expect(pkOptions()).toEqual([
      { label: NO_PK, value: '' },
      { label: 'first_name ← First Name', value: 'first_name' },
      { label: 'id', value: 'id' },
      { label: 'id_2 ← ID', value: 'id_2' },
    ])
    expect(pkSelect()).toHaveValue('')
  })

  it('switching the header checkbox off replaces the candidates with col_1 … col_n and shows the first-line hint', async () => {
    await renderForm()
    chooseFile('a,b,c\n1,2,3\n', 'abc.csv')
    await screen.findByRole('option', { name: 'a' })
    expect(screen.queryByText(FIRST_LINE_HINT)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('first line is a header'))

    expect(screen.getByLabelText('first line is a header')).not.toBeChecked()
    expect(pkOptions().map((option) => option.label)).toEqual([NO_PK, 'col_1', 'col_2', 'col_3'])
    expect(screen.getByText(FIRST_LINE_HINT)).toBeInTheDocument()
  })

  it('falls back to (none) when the chosen primary key is no longer a candidate', async () => {
    await renderForm()
    chooseFile('id,name\n1,ann\n', 'people.csv')
    await screen.findByRole('option', { name: 'id' })

    fireEvent.change(pkSelect(), { target: { value: 'id' } })
    expect(pkSelect()).toHaveValue('id')

    fireEvent.click(screen.getByLabelText('first line is a header'))
    expect(pkSelect()).toHaveValue('')
    fireEvent.click(screen.getByLabelText('first line is a header'))
    expect(pkSelect()).toHaveValue('')

    fireEvent.change(pkSelect(), { target: { value: 'name' } })
    expect(pkSelect()).toHaveValue('name')
    fireEvent.click(formatButton('tsv'))
    expect(pkSelect()).toHaveValue('')
  })

  it('shows the _row hint only while no primary key is chosen', async () => {
    await renderForm()
    expect(screen.getByText(ROW_HINT)).toBeInTheDocument()
    chooseFile('id,name\n1,ann\n', 'people.csv')
    await screen.findByRole('option', { name: 'id' })

    fireEvent.change(pkSelect(), { target: { value: 'id' } })
    expect(screen.queryByText(ROW_HINT)).not.toBeInTheDocument()

    fireEvent.change(pkSelect(), { target: { value: '' } })
    expect(screen.getByText(ROW_HINT)).toBeInTheDocument()
  })

  it('disables the button and every input and shows "importing…" while the request is in flight', async () => {
    await renderForm()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post(FROM_FILE_URL, async () => {
        await gate
        return HttpResponse.json(peopleBody(), { status: 201 })
      }),
    )
    chooseFile('First Name,city\nann,x\nbob,y\n', 'people.csv')
    await screen.findByRole('option', { name: 'city' })

    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    const busy = await screen.findByRole('button', { name: 'importing…' })
    expect(busy).toBeDisabled()
    expect(screen.getByLabelText('choose file…')).toBeDisabled()
    expect(formatButton('csv')).toBeDisabled()
    expect(formatButton('tsv')).toBeDisabled()
    expect(screen.getByLabelText('table name')).toBeDisabled()
    expect(screen.getByLabelText('first line is a header')).toBeDisabled()
    expect(pkSelect()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'close' })).not.toBeDisabled()

    release()
    await screen.findByText('table people created')
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()
    expect(screen.getByLabelText('table name')).not.toBeDisabled()
  })

  it('posts name, format and header from the form and omits pk while (none) is selected', async () => {
    await renderForm()
    const urls = await importPeople()

    expect(urls).toHaveLength(1)
    expect(urls[0]?.searchParams.get('name')).toBe('people')
    expect(urls[0]?.searchParams.get('format')).toBe('csv')
    expect(urls[0]?.searchParams.get('header')).toBe('true')
    expect(urls[0]?.searchParams.has('pk')).toBe(false)

    fireEvent.change(pkSelect(), { target: { value: 'first_name' } })
    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'people2' } })
    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    await waitFor(() => expect(urls).toHaveLength(2))
    expect(urls[1]?.searchParams.get('name')).toBe('people2')
    expect(urls[1]?.searchParams.get('pk')).toBe('first_name')
  })

  it('on 201 shows the created table, the summary, the schema chips with source headers and the call line, and invalidates the rel-tables cache', async () => {
    const { queryClient } = await renderForm()
    let tableFetches = 0
    server.use(
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => {
        tableFetches += 1
        return HttpResponse.json([{ name: 'people', _links: { self: '', rows: '' } }])
      }),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await importPeople()

    expect(screen.getByText('table people created')).toBeInTheDocument()
    expect(document.querySelector('.rfi__summary')?.textContent).toBe('imported 2 · failed 0')
    expect(document.querySelector('.rfi__summary-failed')).toBeNull()

    const chips = Array.from(document.querySelectorAll('.rfi__col-chip'))
    expect(chips.map((chip) => chip.textContent)).toEqual(['●_row·INTEGER', 'first_name·TEXT ← First Name', 'city·TEXT'])
    expect(chips[0]?.querySelector('.rfi__col-chip-pk') ?? null).not.toBeNull()
    expect(chips[1]?.querySelector('.rfi__col-chip-pk') ?? null).toBeNull()
    expect(screen.getByText('← First Name')).toHaveClass('rfi__col-chip-src')

    expect(screen.getByText('POST /store-api/rel/shop/tables/from-file?name=people&format=csv&header=true')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open table →' })).toBeInTheDocument()

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rel-tables', 'shop'] })
    await waitFor(() => expect(tableFetches).toBeGreaterThan(0))
  })

  it('"open table →" navigates to the rel browser for the new table and closes', async () => {
    const onClose = vi.fn()
    await renderForm(onClose)
    await importPeople()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)

    fireEvent.click(screen.getByRole('button', { name: 'open table →' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/data?engine=rel&table=people')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lists every row error with its row number and marks failed in the error colour on a partial success', async () => {
    await renderForm()
    const errors = Array.from({ length: 120 }, (_, index) => ({
      row: index + 3,
      error: `CSV error: record ${index + 3} (line: ${index + 4}, byte: 48): found record with 3 fields, but the previous record has 4 fields`,
    }))
    await importPeople(peopleBody({ imported: 5, failed: 120, errors }))

    expect(document.querySelector('.rfi__summary')?.textContent).toBe('imported 5 · failed 120')
    expect(screen.getByText('failed 120')).toHaveClass('rfi__summary-failed')
    const items = Array.from(document.querySelectorAll('.rfi__errors li'))
    expect(items).toHaveLength(120)
    expect(items[0]?.textContent).toBe(`row 3 · ${errors[0]?.error}`)
    expect(items[119]?.textContent).toBe(`row 122 · ${errors[119]?.error}`)
    expect(screen.queryByText(/the table was created and is empty/)).not.toBeInTheDocument()
  })

  it('shows the empty-table warning when nothing was imported and rows failed', async () => {
    await renderForm()
    await importPeople(peopleBody({ imported: 0, failed: 1, errors: [{ row: 1, error: 'bad row' }] }))

    expect(screen.getByText('the table was created and is empty — drop it in the sql console if the file was wrong')).toBeInTheDocument()
    expect(screen.getByText('row 1 · bad row')).toBeInTheDocument()
  })

  it('does not flag the table it just created as a name collision', async () => {
    await renderForm()
    let tableFetches = 0
    server.use(
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => {
        tableFetches += 1
        return HttpResponse.json([{ name: 'people', _links: { self: '', rows: '' } }])
      }),
    )
    await importPeople()
    await waitFor(() => expect(tableFetches).toBeGreaterThan(0))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'orders' } })
    expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText('table name'), { target: { value: 'people' } })
    expect(screen.getByRole('button', { name: 'import' })).toBeDisabled()
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
  })

  async function failImport(status: number, text: string): Promise<void> {
    server.use(http.post(FROM_FILE_URL, () => new HttpResponse(text, { status, headers: { 'Content-Type': 'text/plain' } })))
    chooseFile('First Name,city\nann,x\n', 'people.csv')
    await screen.findByText('people.csv · 22 B')
    await waitForRead()
    fireEvent.click(screen.getByRole('button', { name: 'import' }))
    await screen.findByText(text)
  }

  function expectOneErrorLine(text: string): void {
    const lines = Array.from(document.querySelectorAll('.rfi__body .rfi__error'))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.textContent).toBe(text)
    expect(document.querySelector('.rfi__result')).toBeNull()
    expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled()
    expect(screen.getByLabelText('table name')).not.toBeDisabled()
  }

  const LIMIT_HINT = 'the server limits the request body (~64 MiB measured) — split the file or import it with the cli'

  it('shows a 400 inline with the original server text', async () => {
    await renderForm()
    const text = "invalid schema: pk column 'first name' not found"
    await failImport(400, text)

    expectOneErrorLine(text)
    expect(screen.queryByText(LIMIT_HINT)).not.toBeInTheDocument()
  })

  it('shows a 409 inline with the original server text', async () => {
    await renderForm()
    const text = "table 'people' already exists"
    await failImport(409, text)

    expectOneErrorLine(text)
    expect(screen.queryByText(LIMIT_HINT)).not.toBeInTheDocument()
  })

  it('shows a 413 inline with the original server text and the body-limit hint', async () => {
    await renderForm()
    const text = 'Failed to buffer the request body: length limit exceeded'
    await failImport(413, text)

    expectOneErrorLine(text)
    const hint = screen.getByText(LIMIT_HINT)
    expect(hint).toHaveClass('rfi__hint')
    expect(hint.previousElementSibling).toHaveClass('rfi__error')
  })
})
