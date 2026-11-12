import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { resetReindexTasks } from '../../lib'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { domainResponse, server } from '../../test/msw'
import { resetDocsState, useDocsState } from '../docs/docsStore'
import { DataScreen } from './DataScreen'

const ORIGIN = window.location.origin
const DOMAIN = 'shop'
const DOCS_URL = `${ORIGIN}/store-api/json/${DOMAIN}/documents`
const SEARCH_URL = `${ORIGIN}/store-api/json/${DOMAIN}/search`
const EXPORT_URL = `${ORIGIN}/store-api/json/${DOMAIN}/export`

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function baseHandlers() {
  return [
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse(DOMAIN)])),
    http.get(`${ORIGIN}/store-api/json/${DOMAIN}/indexes`, () => HttpResponse.json([])),
  ]
}

function documentHandler(key: string, version: number, fields: Record<string, unknown>, etag: string) {
  return http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/${key}`, () =>
    HttpResponse.json({ _key: key, _version: version, ...fields }, { headers: { ETag: etag } }),
  )
}

function DocsRouteProbe() {
  const docs = useDocsState()
  return <p data-testid="docs-screen">docs: {docs.activeId ?? ''}</p>
}

// `extraHandlers` kommen vor den Basis-Handlern in denselben `server.use()`-Aufruf (MSW: pro Aufruf gewinnt die
// zuerst gelistete Route) — sonst würde `baseHandlers`' fixe `GET …/indexes → []` jeden Test-Override verdecken.
async function connectAndRender(extraHandlers: Parameters<typeof server.use> = [], initialPath = '/data') {
  server.use(...extraHandlers, ...baseHandlers())
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  const view = render(
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
  return { queryClient, ...view }
}

function footerText(): string {
  return document.querySelector('.data__footer')?.textContent ?? ''
}

// Referenced-by probes the rel tables of every domain; a test's own handler is registered later and wins.
beforeEach(() => {
  server.use(http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json([])))
})

afterEach(() => {
  act(() => disconnect())
  resetDocsState()
  resetReindexTasks()
})

const INDEXES_URL = `${ORIGIN}/store-api/json/${DOMAIN}/indexes`

async function openIndexPanel(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^idx:/ }))
}

describe('JsonBrowser', () => {
  it('arrives with ?key= (cross-engine jump from the rel row detail): selects that document initially, loaded independently of the listed page (spec data/009 §5)', async () => {
    await connectAndRender(
      [
        http.get(DOCS_URL, () =>
          HttpResponse.json({
            documents: [{ _key: 'cus_1', _version: 1, name: 'first' }],
            keys: ['cus_1'],
            total: 1,
            offset: 0,
            limit: 50,
          }),
        ),
        documentHandler('cus_8102', 7, { name: 'M. Keller' }, '"etag-1"'),
      ],
      '/data?engine=json&key=cus_8102',
    )

    expect(await screen.findByText('DOCUMENT cus_8102')).toBeInTheDocument()
    expect(screen.getByText(/"name": "M. Keller"/)).toBeInTheDocument()
  })

  it('keeps the ?key= arrival selection when the document list is already in the query cache (nachtrag data/009: auto-select overwrote it)', async () => {
    // Erster Besuch ohne ?key= füllt den Query-Cache (Auto-Select auf das erste Dokument), dann Ankunft per Jump.
    const { queryClient, unmount } = await connectAndRender([
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_1', _version: 1, name: 'first' }],
          keys: ['cus_1'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_1', 1, { name: 'first' }, '"etag-0"'),
      documentHandler('cus_8102', 7, { name: 'M. Keller' }, '"etag-1"'),
    ])
    expect(await screen.findByText('DOCUMENT cus_1')).toBeInTheDocument()
    unmount()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/data?engine=json&key=cus_8102']}>
          <SelectedDomainProvider>
            <Routes>
              <Route path="/data" element={<DataScreen />} />
            </Routes>
          </SelectedDomainProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('DOCUMENT cus_8102')).toBeInTheDocument()
    expect(await screen.findByText(/"name": "M. Keller"/)).toBeInTheDocument()
  })

  it('lists documents via GET when the filter is empty, and shows the raw call in the footer', async () => {
    server.use(
      http.get(DOCS_URL, ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('limit')).toBe('50')
        expect(url.searchParams.get('offset')).toBe('0')
        return HttpResponse.json({
          documents: [
            { _key: 'cus_8102', _version: 7, name: 'M. Keller', city: 'Essen' },
            { _key: 'cus_8144', _version: 2, name: 'S. Weber', city: 'Essen' },
          ],
          keys: ['cus_8102', 'cus_8144'],
          total: 8102,
          offset: 0,
          limit: 50,
        })
      }),
      documentHandler('cus_8102', 7, { name: 'M. Keller', city: 'Essen' }, '"etag-1"'),
    )
    await connectAndRender()

    expect(await screen.findByText('cus_8102')).toBeInTheDocument()
    expect(screen.getByText('{"name":"M. Keller","city":"Essen"}')).toBeInTheDocument()
    expect(screen.getByText('v7')).toBeInTheDocument()
    expect(screen.getByText('cus_8144')).toBeInTheDocument()

    await waitFor(() => expect(footerText()).toContain('2 of 8,102'))
    expect(footerText()).toContain('GET /store-api/json/shop/documents?limit=50&offset=0')

    // Auto-selected first row renders the detail column, pretty-printed without _key/_version.
    expect(await screen.findByText('DOCUMENT cus_8102')).toBeInTheDocument()
    expect(screen.getByText(/"city": "Essen"/)).toBeInTheDocument()
    expect(screen.getByText(`GET /store-api/json/${DOMAIN}/documents/cus_8102`)).toBeInTheDocument()
  })

  it('searches with an operator filter via POST, and shows the body in the footer', async () => {
    let requestBody: unknown
    server.use(
      http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
      http.post(SEARCH_URL, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          documents: [{ _key: 'cus_9001', _version: 1, city: 'Bochum' }],
          total: 1,
          offset: 0,
          limit: 50,
        })
      }),
      documentHandler('cus_9001', 1, { city: 'Bochum' }, '"etag-9"'),
    )
    await connectAndRender()

    fireEvent.change(await screen.findByLabelText('document filter'), { target: { value: '{"city": {"$gt": "A"}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(requestBody).toEqual({ filter: { city: { $gt: 'A' } }, limit: 50, offset: 0 }))
    expect(await screen.findByText('cus_9001')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain('1 of 1'))
    expect(footerText()).toContain('POST /store-api/json/shop/search')
    expect(footerText()).toContain('body {"filter":{"city":{"$gt":"A"}},"limit":50,"offset":0}')
  })

  it('shows a parse error inline under the filter and never fires the search request', async () => {
    let called = false
    server.use(
      http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
      http.post(SEARCH_URL, () => {
        called = true
        return HttpResponse.json({ documents: [], total: 0, offset: 0, limit: 50 })
      }),
    )
    await connectAndRender()
    await screen.findByText('no documents')

    fireEvent.change(screen.getByLabelText('document filter'), { target: { value: '{city:' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(document.querySelector('.json__filter-error')).not.toBeNull())
    expect(document.querySelector('.json__filter-error')?.textContent?.length).toBeGreaterThan(0)
    expect(called).toBe(false)
  })

  it('falls back to an empty-object error when the filter parses but is not a JSON object', async () => {
    server.use(http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })))
    await connectAndRender()
    await screen.findByText('no documents')

    fireEvent.change(screen.getByLabelText('document filter'), { target: { value: '"just a string"' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('filter must be a JSON object')).toBeInTheDocument()
  })

  it('shows a red conflict line with a docs link on a 412 version conflict, without silently overwriting', async () => {
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_1', _version: 3, name: 'old' }],
          keys: ['cus_1'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_1', 3, { name: 'old' }, '"etag-1"'),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"etag-1"')
        return new HttpResponse(null, { status: 412 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    expect(await screen.findByLabelText('document editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(await screen.findByText(/version conflict — the document changed on the server/)).toBeInTheDocument()
    // Der Editor bleibt offen (kein stilles Überschreiben) statt zur Pretty-Ansicht zurückzuspringen.
    expect(screen.getByLabelText('document editor')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(await screen.findByTestId('docs-screen')).toHaveTextContent('docs: errors-status-codes')
  })

  it('keeps the edited text after reload and sends the new ETag', async () => {
    let version = 2
    const ifMatches: Array<string | null> = []
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({ documents: [{ _key: 'cus_1', _version: 2, name: 'old' }], keys: ['cus_1'], total: 1, offset: 0, limit: 50 }),
      ),
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, () =>
        HttpResponse.json({ _key: 'cus_1', _version: version, name: 'old' }, { headers: { ETag: `"etag-${version}"` } }),
      ),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, ({ request }) => {
        ifMatches.push(request.headers.get('if-match'))
        if (ifMatches.length === 1) {
          version = 3
          return HttpResponse.json({ error: 'server detail text' }, { status: 412 })
        }
        return HttpResponse.json({ _key: 'cus_1', _version: 4, name: 'mine' })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    expect(await screen.findByLabelText('document editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(await screen.findByText(/version conflict — the document changed on the server/)).toBeInTheDocument()
    expect(screen.queryByText(/server detail text/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(await screen.findByText('reloaded — saving now overwrites version 3')).toBeInTheDocument()
    expect(screen.queryByText(/version conflict/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('document editor')).toHaveTextContent('"name": "old"')

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(ifMatches).toEqual(['"etag-2"', '"etag-3"']))
    await waitFor(() => expect(screen.queryByText(/reloaded —/)).not.toBeInTheDocument())
  })

  it('keeps the ETag of the edit start when the document refetches meanwhile', async () => {
    let etag = '"etag-1"'
    let ifMatch: string | null = null
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({ documents: [{ _key: 'cus_1', _version: 1, name: 'old' }], keys: ['cus_1'], total: 1, offset: 0, limit: 50 }),
      ),
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, () =>
        HttpResponse.json({ _key: 'cus_1', _version: 1, name: 'old' }, { headers: { ETag: etag } }),
      ),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, ({ request }) => {
        ifMatch = request.headers.get('if-match')
        return HttpResponse.json({ _key: 'cus_1', _version: 2, name: 'old' })
      }),
    )
    const { queryClient } = await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    expect(await screen.findByLabelText('document editor')).toBeInTheDocument()
    etag = '"etag-foreign"'
    await act(() => queryClient.invalidateQueries({ queryKey: ['json-document', DOMAIN, 'cus_1'] }))
    expect(queryClient.getQueryData<{ etag: string }>(['json-document', DOMAIN, 'cus_1'])?.etag).toBe('"etag-foreign"')
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(ifMatch).toBe('"etag-1"'))
  })

  it('reloads after a delete conflict and sends the new ETag on the second delete', async () => {
    let version = 1
    let deleted = false
    const ifMatches: Array<string | null> = []
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: deleted ? [] : [{ _key: 'cus_1', _version: 1, name: 'x' }],
          keys: deleted ? [] : ['cus_1'],
          total: deleted ? 0 : 1,
          offset: 0,
          limit: 50,
        }),
      ),
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, () =>
        HttpResponse.json({ _key: 'cus_1', _version: version, name: 'x' }, { headers: { ETag: `"etag-${version}"` } }),
      ),
      http.delete(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, ({ request }) => {
        ifMatches.push(request.headers.get('if-match'))
        if (ifMatches.length === 1) {
          version = 2
          return new HttpResponse(null, { status: 412 })
        }
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete — sure?' }))
    expect(await screen.findByText(/version conflict — the document changed on the server/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(await screen.findByText('reloaded — deleting now removes version 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'delete — sure?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'delete — sure?' }))
    await waitFor(() => expect(ifMatches).toEqual(['"etag-1"', '"etag-2"']))
    expect(await screen.findByText('select a document')).toBeInTheDocument()
  })

  it('saves an edit successfully and invalidates the list (updated version shows up)', async () => {
    let version = 1
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_2', _version: version, name: 'v1' }],
          keys: ['cus_2'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_2`, () =>
        HttpResponse.json({ _key: 'cus_2', _version: version, name: 'v1' }, { headers: { ETag: `"etag-${version}"` } }),
      ),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_2`, () => {
        version = 2
        return HttpResponse.json({ _key: 'cus_2', _version: 2, name: 'v1' })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument())
    expect(await screen.findByText('v2')).toBeInTheDocument()
  })

  it('unwraps a scalar _content document and writes the bare scalar back (general/013 §6)', async () => {
    let sentBody: string | undefined
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'scalar', _version: 1, _content: 42 }],
          keys: ['scalar'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/scalar`, () =>
        HttpResponse.json({ _key: 'scalar', _version: 1, _content: 42 }, { headers: { ETag: '"etag-s"' } }),
      ),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/scalar`, async ({ request }) => {
        sentBody = await request.text()
        return HttpResponse.json({ _key: 'scalar', _version: 2, _content: 42 })
      }),
    )
    await connectAndRender()

    expect(await screen.findByText('DOCUMENT scalar')).toBeInTheDocument()
    // Listen-Preview und Detail zeigen beide den Skalar, nicht den `_content`-Wrapper.
    expect(screen.getAllByText('42')).toHaveLength(2)
    expect(screen.queryByText(/_content/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    expect(await screen.findByLabelText('document editor')).toHaveTextContent('42')
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    // Der Editor war mit dem Skalar vorbelegt — gespeichert wird er ohne `_content`-Wrapper (sonst 400).
    await waitFor(() => expect(sentBody).toBe('42'))
  })

  it('arms and confirms delete, then removes the document from the invalidated list', async () => {
    let deleted = false
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: deleted ? [] : [{ _key: 'cus_3', _version: 1, name: 'gone-soon' }],
          keys: deleted ? [] : ['cus_3'],
          total: deleted ? 0 : 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_3', 1, { name: 'gone-soon' }, '"etag-3"'),
      http.delete(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_3`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete — sure?' }))

    await waitFor(() => expect(screen.queryByText('cus_3')).not.toBeInTheDocument())
    expect(await screen.findByText('select a document')).toBeInTheDocument()
  })

  it('sends If-Match on delete and keeps the armed state on 412', async () => {
    let ifMatch: string | null = null
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_1', _version: 1, name: 'used' }],
          keys: ['cus_1'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_1', 1, { name: 'used' }, '"etag-1"'),
      http.delete(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_1`, ({ request }) => {
        ifMatch = request.headers.get('if-match')
        return new HttpResponse(null, { status: 412 })
      }),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json([{ name: 'entrances', _links: { self: '', rows: '' } }])),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables/entrances`, () =>
        HttpResponse.json({
          name: 'entrances',
          created_at: 1,
          indexes: [],
          _links: { self: '', rows: '' },
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, unique: false, autoincrement: true },
            { name: 'door_id', type: 'JSONREF', nullable: true, primary_key: false, unique: false, autoincrement: false },
          ],
        }),
      ),
      http.post(`${ORIGIN}/store-api/rel/${DOMAIN}/sql`, () =>
        HttpResponse.json({ columns: [{ name: 'COUNT(*)', type: 'INTEGER' }], rows: [[3]], row_count: 1, limit_applied: false }),
      ),
    )
    await connectAndRender()

    expect(await screen.findByText('entrances.door_id · 3 rows')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete — sure?' }))

    expect(await screen.findByText(/version conflict/)).toBeInTheDocument()
    expect(ifMatch).toBe('"etag-1"')
    expect(screen.getByRole('button', { name: 'delete — sure?' })).toBeInTheDocument()
    expect(screen.getByText('referenced by 3 rows in entrances.door_id')).toBeInTheDocument()
    expect(screen.queryByText(/delete failed/)).not.toBeInTheDocument()
  })

  it('creates a new document via POST when no key is given, then selects it', async () => {
    server.use(
      http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
      http.post(DOCS_URL, async ({ request }) => {
        expect(await request.json()).toEqual({})
        return HttpResponse.json({ _key: 'generated-1', _version: 1 }, { status: 201 })
      }),
      documentHandler('generated-1', 1, {}, '"etag-g1"'),
    )
    await connectAndRender()
    await screen.findByText('no documents')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('DOCUMENT generated-1')).toBeInTheDocument()
  })

  it('creates a document under a chosen key with If-None-Match and no prior GET', async () => {
    let putCalled = false
    let getBeforePut = false
    let ifNoneMatch: string | null = null
    let contentType: string | null = null
    server.use(
      http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
      http.get(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_own`, () => {
        if (!putCalled) getBeforePut = true
        return HttpResponse.json({ _key: 'cus_own', _version: 1 }, { headers: { ETag: '"etag-1"' } })
      }),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_own`, async ({ request }) => {
        expect(await request.json()).toEqual({})
        ifNoneMatch = request.headers.get('If-None-Match')
        contentType = request.headers.get('Content-Type')
        putCalled = true
        return HttpResponse.json({ _key: 'cus_own', _version: 1 }, { status: 201 })
      }),
    )
    await connectAndRender()
    await screen.findByText('no documents')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new document key'), { target: { value: 'cus_own' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('DOCUMENT cus_own')).toBeInTheDocument()
    expect(putCalled).toBe(true)
    expect(getBeforePut).toBe(false)
    expect(ifNoneMatch).toBe('*')
    expect(contentType).toBe('application/json')
  })

  it('shows key already exists on 412 when creating', async () => {
    let putCount = 0
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_taken', _version: 1, name: 'existing' }],
          keys: ['cus_taken'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      http.put(`${ORIGIN}/store-api/json/${DOMAIN}/documents/cus_taken`, ({ request }) => {
        expect(request.headers.get('If-None-Match')).toBe('*')
        putCount += 1
        return HttpResponse.json({ error: 'precondition failed' }, { status: 412 })
      }),
    )
    await connectAndRender()
    await screen.findByText('cus_taken')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new document key'), { target: { value: 'cus_taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('key already exists')).toBeInTheDocument()
    expect(putCount).toBe(1)
  })

  it('builds the referenced-by COUNT(*) probe and navigates the rel browser, filtered, on click', async () => {
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_8102', _version: 7, name: 'M. Keller' }],
          keys: ['cus_8102'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_8102', 7, { name: 'M. Keller' }, '"etag-1"'),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json([{ name: 'orders', _links: { self: '', rows: '' } }])),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables/orders`, () =>
        HttpResponse.json({
          name: 'orders',
          created_at: 1,
          indexes: [],
          _links: { self: '', rows: '' },
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, unique: false, autoincrement: true },
            { name: 'customer_ref', type: 'JSONREF', nullable: true, primary_key: false, unique: false, autoincrement: false },
          ],
        }),
      ),
      http.post(`${ORIGIN}/store-api/rel/${DOMAIN}/sql`, async ({ request }) => {
        const body = (await request.json()) as { sql: string }
        // Referenced-by-Probe (data/004 §3) und die Filter-Ankunft des REL-Browsers (data/003) teilen sich den Endpunkt.
        if (body.sql.startsWith('SELECT COUNT(*)')) {
          expect(body).toEqual({ sql: 'SELECT COUNT(*) FROM orders WHERE customer_ref = ?', params: ['cus_8102'] })
          return HttpResponse.json({
            columns: [{ name: 'COUNT(*)', type: 'INTEGER' }],
            rows: [[6]],
            row_count: 1,
            limit_applied: false,
          })
        }
        expect(body).toEqual({ sql: 'SELECT * FROM orders WHERE customer_ref = ? LIMIT 50', params: ['cus_8102'] })
        return HttpResponse.json({
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'customer_ref', type: 'JSONREF' },
          ],
          rows: [
            [1, 'cus_8102'],
            [2, 'cus_8102'],
          ],
          row_count: 2,
          limit_applied: false,
        })
      }),
    )
    await connectAndRender()

    expect(await screen.findByText('orders.customer_ref · 6 rows')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /orders\.customer_ref/ }))

    expect(await screen.findByText('shop / orders')).toBeInTheDocument()
    expect(await screen.findByText(/filtered: customer_ref = cus_8102/)).toBeInTheDocument()
    // Endzustand: Filterbar-Wert + zwei Grid-Zellen — auf die Anzahl pollen statt einen Übergangszustand zu erwischen.
    await waitFor(() => expect(screen.getAllByText('cus_8102')).toHaveLength(3))
  })

  it('shows a candidate column with 0 uses as a calm, non-clickable card, and names it in the armed delete-guard', async () => {
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_1', _version: 1, name: 'unused' }],
          keys: ['cus_1'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_1', 1, { name: 'unused' }, '"etag-1"'),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json([{ name: 'orders', _links: { self: '', rows: '' } }])),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables/orders`, () =>
        HttpResponse.json({
          name: 'orders',
          created_at: 1,
          indexes: [],
          _links: { self: '', rows: '' },
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, unique: false, autoincrement: true },
            { name: 'customer_ref', type: 'JSONREF', nullable: true, primary_key: false, unique: false, autoincrement: false },
          ],
        }),
      ),
      http.post(`${ORIGIN}/store-api/rel/${DOMAIN}/sql`, () =>
        HttpResponse.json({ columns: [{ name: 'COUNT(*)', type: 'INTEGER' }], rows: [[0]], row_count: 1, limit_applied: false }),
      ),
    )
    await connectAndRender()

    expect(await screen.findByText('orders.customer_ref · 0 rows')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /orders\.customer_ref/ })).toBeDisabled()

    // Armed delete-guard bleibt still ohne N>0-Karten (0 rows blockiert und nennt sich nicht).
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    expect(screen.queryByText(/referenced by/)).not.toBeInTheDocument()
  })

  it('shows the used-by info line in the armed delete-guard when a candidate column has N>0 uses', async () => {
    server.use(
      http.get(DOCS_URL, () =>
        HttpResponse.json({
          documents: [{ _key: 'cus_1', _version: 1, name: 'used' }],
          keys: ['cus_1'],
          total: 1,
          offset: 0,
          limit: 50,
        }),
      ),
      documentHandler('cus_1', 1, { name: 'used' }, '"etag-1"'),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables`, () => HttpResponse.json([{ name: 'entrances', _links: { self: '', rows: '' } }])),
      http.get(`${ORIGIN}/store-api/rel/${DOMAIN}/tables/entrances`, () =>
        HttpResponse.json({
          name: 'entrances',
          created_at: 1,
          indexes: [],
          _links: { self: '', rows: '' },
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primary_key: true, unique: false, autoincrement: true },
            { name: 'door_id', type: 'JSONREF', nullable: true, primary_key: false, unique: false, autoincrement: false },
          ],
        }),
      ),
      http.post(`${ORIGIN}/store-api/rel/${DOMAIN}/sql`, () =>
        HttpResponse.json({ columns: [{ name: 'COUNT(*)', type: 'INTEGER' }], rows: [[3]], row_count: 1, limit_applied: false }),
      ),
    )
    await connectAndRender()

    expect(await screen.findByText('entrances.door_id · 3 rows')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    expect(await screen.findByText('referenced by 3 rows in entrances.door_id')).toBeInTheDocument()
  })

  it('exports ndjson via the recorder-hooked GET, disabling the button meanwhile, and downloads {domain}.ndjson', async () => {
    const blobs: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      value: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:mock'
      },
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
    const anchors: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this)
    })

    let resolveExport: (() => void) | undefined
    server.use(
      http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
      http.get(EXPORT_URL, async () => {
        await new Promise<void>((resolve) => {
          resolveExport = resolve
        })
        return new HttpResponse('{"_key":"a","_version":1}\n{"_key":"b","_version":1}\n', {
          headers: { 'content-type': 'application/x-ndjson' },
        })
      }),
    )
    await connectAndRender()
    await screen.findByText('no documents')

    fireEvent.click(screen.getByRole('button', { name: 'export ndjson ↓' }))
    expect(await screen.findByRole('button', { name: 'exporting…' })).toBeDisabled()
    resolveExport?.()

    await waitFor(() => expect(screen.getByRole('button', { name: 'export ndjson ↓' })).toBeInTheDocument())
    expect(anchors[0]?.download).toBe(`${DOMAIN}.ndjson`)
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blobs[0]!)
    })
    expect(content).toBe('{"_key":"a","_version":1}\n{"_key":"b","_version":1}\n')

    vi.restoreAllMocks()
  })

  it('shows the export error inline under the header on failure, without an alert', async () => {
    server.use(
      http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })),
      http.get(EXPORT_URL, () => HttpResponse.json({ error: 'domain not found' }, { status: 404 })),
    )
    await connectAndRender()
    await screen.findByText('no documents')

    fireEvent.click(screen.getByRole('button', { name: 'export ndjson ↓' }))

    expect(await screen.findByText('domain not found')).toBeInTheDocument()
  })

  // Bulk-Import öffnet seit spec data/007 §1 ein Modal per natives <dialog> + showModal() — in diesem jsdom
  // nicht implementiert (vgl. RelBrowser.test.tsx zu "check links"). Der Formular-/Ergebnis-Flow selbst ist
  // <dialog>-frei in BulkImportModal.test.tsx gegen BulkImportForm getestet; hier nur der Einstiegspunkt.
  it('shows the "import ndjson ↑" entry point next to export', async () => {
    server.use(http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 })))
    await connectAndRender()
    await screen.findByText('no documents')

    expect(screen.getByRole('button', { name: 'import ndjson ↑' })).toBeInTheDocument()
  })

  describe('index panel (spec data/006)', () => {
    const emptyDocs = http.get(DOCS_URL, () => HttpResponse.json({ documents: [], keys: [], total: 0, offset: 0, limit: 50 }))

    it('toggles the idx pill open and renders the index list in contract form (field · type · created)', async () => {
      await connectAndRender([emptyDocs, http.get(INDEXES_URL, () => HttpResponse.json([{ field: 'city', type: 'string', created_at: 1 }]))])

      await openIndexPanel()

      expect(await screen.findByText('city · string · 1970-01-01')).toBeInTheDocument()
      expect(screen.getByText(`GET /store-api/json/${DOMAIN}/indexes`)).toBeInTheDocument()
    })

    it('create success invalidates the shared cache (pill text updates) and shows the reindex hint', async () => {
      let created = false
      let requestBody: unknown
      await connectAndRender([
        emptyDocs,
        http.get(INDEXES_URL, () => HttpResponse.json(created ? [{ field: 'city', type: 'string', created_at: 1 }] : [])),
        http.post(INDEXES_URL, async ({ request }) => {
          requestBody = await request.json()
          created = true
          return HttpResponse.json({ field: 'city', type: 'string', created_at: 1 }, { status: 201 })
        }),
      ])
      await openIndexPanel()
      expect(await screen.findByText('no indexes yet')).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('index field'), { target: { value: 'city' } })
      fireEvent.click(screen.getByRole('button', { name: 'create index' }))

      await waitFor(() => expect(requestBody).toEqual({ field: 'city', type: 'string' }))
      expect(await screen.findByRole('button', { name: /^idx: city/ })).toBeInTheDocument()
      expect(screen.getByText('existing documents are not back-indexed')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'reindex now' })).toBeInTheDocument()
    })

    it('create 409 shows the original server error text inline', async () => {
      await connectAndRender([
        emptyDocs,
        http.get(INDEXES_URL, () => HttpResponse.json([])),
        http.post(INDEXES_URL, () => HttpResponse.text("index on field 'city' already exists in domain 'shop'", { status: 409 })),
      ])
      await openIndexPanel()

      fireEvent.change(screen.getByLabelText('index field'), { target: { value: 'city' } })
      fireEvent.click(screen.getByRole('button', { name: 'create index' }))

      expect(await screen.findByText("index on field 'city' already exists in domain 'shop'")).toBeInTheDocument()
    })

    it('delete removes the row from the (invalidated) list', async () => {
      let deleted = false
      await connectAndRender([
        emptyDocs,
        http.get(INDEXES_URL, () => HttpResponse.json(deleted ? [] : [{ field: 'city', type: 'string', created_at: 1 }])),
        http.delete(`${INDEXES_URL}/city`, () => {
          deleted = true
          return new HttpResponse(null, { status: 204 })
        }),
      ])
      await openIndexPanel()
      expect(await screen.findByText('city · string · 1970-01-01')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('search on this field stops working'))

      await waitFor(() => expect(screen.queryByText('city · string · 1970-01-01')).not.toBeInTheDocument())
      expect(screen.getByText('no indexes yet')).toBeInTheDocument()
    })

    it('"reindex now" calls startReindex with domain + the newly created field', async () => {
      let reindexBody: unknown
      await connectAndRender([
        emptyDocs,
        http.get(INDEXES_URL, () => HttpResponse.json([])),
        http.post(INDEXES_URL, () => HttpResponse.json({ field: 'city', type: 'string', created_at: 1 }, { status: 201 })),
        http.post(`${ORIGIN}/store-api/json/${DOMAIN}/reindex`, async ({ request }) => {
          reindexBody = await request.json()
          return HttpResponse.json({ task_id: 'task_idx1' }, { status: 202 })
        }),
      ])
      await openIndexPanel()

      fireEvent.change(screen.getByLabelText('index field'), { target: { value: 'city' } })
      fireEvent.click(screen.getByRole('button', { name: 'create index' }))

      fireEvent.click(await screen.findByRole('button', { name: 'reindex now' }))

      await waitFor(() => expect(reindexBody).toEqual({ field: 'city' }))
    })
  })
})
