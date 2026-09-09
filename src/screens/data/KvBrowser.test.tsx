import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { kvKeyScan, server } from '../../test/msw'
import { DataScreen } from './DataScreen'

const ORIGIN = window.location.origin
const DOMAIN = 'shop'
const KEYS_URL = `${ORIGIN}/store-api/kv/${DOMAIN}/keys`
const WATCH_URL = `${ORIGIN}/store-api/kv/${DOMAIN}/watch`
const encoder = new TextEncoder()

function keyUrl(key: string): string {
  return `${KEYS_URL}/${key}`
}

function rawValue(text: string) {
  return new HttpResponse(text, { headers: { 'content-type': 'application/octet-stream' } })
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
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.6.1', server_version: '0.4.0' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: DOMAIN, created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
  ]
}

function metaUrl(key: string): string {
  return `${keyUrl(key)}/meta`
}

function metaLine(): string {
  return document.querySelector('.kv-detail__meta')?.textContent ?? ''
}

/** MSW-Handler, der die Frames streamt und den Body offen hält (kein Reconnect während des Tests) — Muster aus useKvWatch.test.tsx. */
function watchStream(frames: string[]) {
  return http.get(WATCH_URL, () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
      },
    })
    return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
}

async function connectAndRender(initialPath = '/data?engine=kv') {
  server.use(...baseHandlers())
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SelectedDomainProvider>
          <Routes>
            <Route path="/data" element={<DataScreen />} />
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

// Fallback vor den Test-Handlern registriert (MSW: zuletzt registriert gewinnt) — ohne Metadaten sieht die Meta-Zeile aus wie vor data/012.
beforeEach(() => {
  server.use(http.get(`${KEYS_URL}/:key/meta`, () => HttpResponse.text('404 Not Found: key not found', { status: 404 })))
})

afterEach(() => {
  act(() => disconnect())
})

describe('KvBrowser', () => {
  it('arrives with ?key= (cross-engine jump from the rel row detail): selects that key initially, even though it is not first in the list (spec data/009 §5)', async () => {
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['alpha', 'cart_1']))),
      http.get(keyUrl('alpha'), () => rawValue('a')),
      http.get(keyUrl('cart_1'), () => rawValue('cart-contents')),
    )
    await connectAndRender('/data?engine=kv&key=cart_1')

    expect(await screen.findByText('KEY cart_1')).toBeInTheDocument()
    expect(screen.getByText('cart-contents')).toBeInTheDocument()
  })

  it('keeps a ?key= arrival open in the detail even when the key is on no loaded page (spec data/011 §6: list membership proves nothing)', async () => {
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['alpha'], { total: 5000 }))),
      http.get(keyUrl('alpha'), () => rawValue('a')),
      http.get(keyUrl('far-away'), () => rawValue('deep value')),
    )
    await connectAndRender('/data?engine=kv&key=far-away')

    expect(await screen.findByText('KEY far-away')).toBeInTheDocument()
    expect(screen.getByText('deep value')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain('1 of 5,000 keys'))
    expect(screen.getByText('KEY far-away')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'far-away' })).not.toBeInTheDocument()
  })

  it('keeps the ?key= arrival selection when the key list is already in the query cache (nachtrag data/009: auto-select overwrote it)', async () => {
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['alpha', 'cart_1']))),
      http.get(keyUrl('alpha'), () => rawValue('a')),
      http.get(keyUrl('cart_1'), () => rawValue('cart-contents')),
    )
    // Erster Besuch ohne ?key= füllt den Query-Cache (Auto-Select auf den ersten Key), dann Ankunft per Jump.
    const { queryClient, unmount } = await connectAndRender()
    expect(await screen.findByText('KEY alpha')).toBeInTheDocument()
    unmount()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/data?engine=kv&key=cart_1']}>
          <SelectedDomainProvider>
            <Routes>
              <Route path="/data" element={<DataScreen />} />
            </Routes>
          </SelectedDomainProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('KEY cart_1')).toBeInTheDocument()
    expect(screen.getByText('cart-contents')).toBeInTheDocument()
  })

  it('scans keys via GET with limit/offset and shows the call in the footer; Scan commits prefix and contains together, omitting empty filters', async () => {
    const urls: URL[] = []
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        const url = new URL(request.url)
        urls.push(url)
        const prefix = url.searchParams.get('prefix')
        const contains = url.searchParams.get('contains')
        if (prefix === 'cart:' && contains === '1') return HttpResponse.json(kvKeyScan(['cart:1'], { total: 1, limit: 100 }))
        if (prefix === 'cart:') return HttpResponse.json(kvKeyScan(['cart:1', 'cart:2'], { total: 2, limit: 100 }))
        return HttpResponse.json(kvKeyScan(['alpha', 'beta'], { total: 1205, limit: 100 }))
      }),
      http.get(keyUrl('alpha'), () => rawValue('a')),
      http.get(keyUrl('cart:1'), () => rawValue('c')),
    )
    await connectAndRender()

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    // `total` ist die gefilterte Trefferzahl aus dem Envelope, nicht die Zahl geladener Keys.
    await waitFor(() => expect(footerText()).toContain('2 of 1,205 keys'))
    expect(footerText()).toContain(`GET /store-api/kv/${DOMAIN}/keys?limit=100&offset=0`)
    expect(footerText()).not.toContain('prefix=')
    expect(footerText()).not.toContain('contains=')
    expect(urls[0]?.searchParams.has('prefix')).toBe(false)
    expect(urls[0]?.searchParams.has('contains')).toBe(false)

    fireEvent.change(screen.getByLabelText('key prefix'), { target: { value: 'cart:' } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }))

    expect(await screen.findByText('cart:2')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain(`2 of 2 keys · GET /store-api/kv/${DOMAIN}/keys?prefix=cart%3A&limit=100&offset=0`))

    fireEvent.change(screen.getByLabelText('key contains'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }))

    await waitFor(() => expect(footerText()).toContain(`1 of 1 keys · GET /store-api/kv/${DOMAIN}/keys?prefix=cart%3A&contains=1&limit=100&offset=0`))
    expect(screen.getByRole('button', { name: 'cart:1' })).toBeInTheDocument()
    expect(screen.queryByText('cart:2')).not.toBeInTheDocument()
    const last = urls[urls.length - 1]
    expect(last?.searchParams.get('prefix')).toBe('cart:')
    expect(last?.searchParams.get('contains')).toBe('1')
  })

  it('pages server-side: "load more" requests offset=100&limit=100, appends the page, and disappears once everything is loaded', async () => {
    const offsets: string[] = []
    const allKeys = Array.from({ length: 150 }, (_, i) => `k${String(i).padStart(3, '0')}`)
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams
        offsets.push(params.get('offset') ?? '')
        const offset = Number(params.get('offset'))
        const limit = Number(params.get('limit'))
        return HttpResponse.json(kvKeyScan(allKeys.slice(offset, offset + limit), { total: allKeys.length, offset, limit }))
      }),
      http.get(`${KEYS_URL}/:key`, () => rawValue('v')),
    )
    await connectAndRender()

    await screen.findByText('k000')
    await waitFor(() => expect(footerText()).toContain('100 of 150 keys'))
    expect(screen.getByText('k099')).toBeInTheDocument()
    expect(screen.queryByText('k100')).not.toBeInTheDocument()
    expect(offsets).toEqual(['0'])

    fireEvent.click(screen.getByRole('button', { name: 'load more' }))

    expect(await screen.findByText('k149')).toBeInTheDocument()
    expect(offsets).toEqual(['0', '100'])
    await waitFor(() => expect(footerText()).toContain('150 of 150 keys'))
    expect(footerText()).toContain(`GET /store-api/kv/${DOMAIN}/keys?limit=100&offset=100`)
    expect(screen.queryByRole('button', { name: 'load more' })).not.toBeInTheDocument()
  })

  it('opens the bulk panel from "bulk…" with its own limit=10000 scan rather than the 100-key pages (spec data/008 §2, data/011 §7)', async () => {
    const limits: string[] = []
    const allKeys = Array.from({ length: 150 }, (_, i) => `k${String(i).padStart(3, '0')}`)
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams
        limits.push(params.get('limit') ?? '')
        const limit = Number(params.get('limit'))
        return HttpResponse.json(kvKeyScan(allKeys.slice(0, limit), { total: allKeys.length, limit }))
      }),
      http.get(`${KEYS_URL}/:key`, () => rawValue('v')),
    )
    await connectAndRender()
    await screen.findByText('k000')

    expect(screen.queryByText(/matching keys/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'bulk…' }))

    await waitFor(() => expect(document.querySelector('.kv-bulk__scope')?.textContent).toContain('150 of 150 matching keys'))
    expect(limits).toEqual(['100', '10000'])
    expect(screen.getByText('150 keys selected')).toBeInTheDocument()
  })

  it('shows JSON pretty-print, plaintext, and an empty value as a plain 0-bytes value (no special state)', async () => {
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['json-key', 'plain-key', 'empty-key']))),
      http.get(keyUrl('json-key'), () => rawValue('{"a":1}')),
      http.get(keyUrl('plain-key'), () => rawValue('hello world')),
      http.get(keyUrl('empty-key'), () => rawValue('')),
    )
    await connectAndRender()

    expect(await screen.findByText('KEY json-key')).toBeInTheDocument()
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument()
    expect(screen.getByText('7 bytes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'plain-key' }))
    expect(await screen.findByText('KEY plain-key')).toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(screen.getByText('11 bytes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'empty-key' }))
    expect(await screen.findByText('KEY empty-key')).toBeInTheDocument()
    expect(screen.getByText('0 bytes')).toBeInTheDocument()
    expect(screen.queryByText(/no content/)).not.toBeInTheDocument()
  })

  it('edits a value: PUTs the raw text unchanged (no reformatting) and invalidates value + list', async () => {
    let putBody: string | undefined
    let contentType: string | null = null
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['raw-key']))),
      http.get(keyUrl('raw-key'), () => rawValue('hello')),
      http.put(keyUrl('raw-key'), async ({ request }) => {
        putBody = await request.text()
        contentType = request.headers.get('content-type')
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    expect(await screen.findByLabelText('value editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(putBody).toBe('hello'))
    expect(contentType).toBe('text/plain')
    expect(await screen.findByRole('button', { name: 'edit' })).toBeInTheDocument()
  })

  it('arms and confirms "set null": PATCHes …/null; the key stays listed (server 0.2.0 upsert) and the detail shows the NULL marker', async () => {
    let nulled = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['null-key']))),
      http.get(keyUrl('null-key'), () => (nulled ? new HttpResponse(null, { status: 204 }) : rawValue('value'))),
      http.patch(`${keyUrl('null-key')}/null`, () => {
        nulled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()
    await screen.findByText('KEY null-key')

    fireEvent.click(await screen.findByRole('button', { name: 'set null' }))
    fireEvent.click(await screen.findByRole('button', { name: 'set null — sure?' }))

    expect(await screen.findByText('NULL')).toBeInTheDocument()
    expect(screen.getByText('explicit null state — GET answers 204')).toBeInTheDocument()
    expect(screen.getByText('null-key')).toBeInTheDocument()
    expect(screen.getByText('KEY null-key')).toBeInTheDocument()
  })

  it('re-scanning with unchanged filters refetches list and open value: a key that expired server-side vanishes from list and detail', async () => {
    let expired = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(expired ? [] : ['zombie']))),
      http.get(keyUrl('zombie'), () => (expired ? new HttpResponse('not found', { status: 404 }) : rawValue('z'))),
    )
    await connectAndRender()
    await screen.findByText('KEY zombie')

    expired = true
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }))

    expect(await screen.findByText('no keys')).toBeInTheDocument()
    expect(screen.getByText('select a key')).toBeInTheDocument()
    expect(screen.queryByText('zombie')).not.toBeInTheDocument()
  })

  it('clears a key that vanished server-side (ttl expiry): the 404 read invalidates the list and the selection empties without leftovers', async () => {
    let expired = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(expired ? [] : ['ttl-key']))),
      http.get(keyUrl('ttl-key'), () => {
        expired = true
        return new HttpResponse('not found', { status: 404 })
      }),
    )
    await connectAndRender()

    expect(await screen.findByText('no keys')).toBeInTheDocument()
    expect(screen.getByText('select a key')).toBeInTheDocument()
    expect(screen.queryByText('ttl-key')).not.toBeInTheDocument()
    expect(screen.queryByText(/not found/)).not.toBeInTheDocument()
  })

  it('arms and confirms delete, then removes the key from the invalidated list', async () => {
    let deleted = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(deleted ? [] : ['gone-key']))),
      http.get(keyUrl('gone-key'), () => rawValue('bye')),
      http.delete(keyUrl('gone-key'), () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete — sure?' }))

    await waitFor(() => expect(screen.queryByText('gone-key')).not.toBeInTheDocument())
    expect(await screen.findByText('select a key')).toBeInTheDocument()
  })

  it('a bulk delete that removes the currently open key clears the detail selection like a single delete (spec data/008 §6)', async () => {
    let deleted = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(deleted ? [] : ['tomb-key']))),
      http.get(keyUrl('tomb-key'), () => (deleted ? new HttpResponse('not found', { status: 404 }) : rawValue('bye'))),
      http.delete(keyUrl('tomb-key'), () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await connectAndRender()
    await screen.findByText('KEY tomb-key')

    fireEvent.click(screen.getByRole('button', { name: 'bulk…' }))
    await screen.findByText('1 keys selected')
    fireEvent.click(screen.getByLabelText('delete'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    await waitFor(() => expect(screen.queryByText('tomb-key')).not.toBeInTheDocument())
    expect(await screen.findByText('select a key')).toBeInTheDocument()
  })

  it('a bulk set null over the currently open key refetches its value: the detail switches to the NULL marker', async () => {
    let nulled = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['null-key']))),
      http.get(keyUrl('null-key'), () => (nulled ? new HttpResponse(null, { status: 204 }) : rawValue('old value'))),
      http.patch(`${keyUrl('null-key')}/null`, () => {
        nulled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()
    await screen.findByText('KEY null-key')
    expect(screen.getByText('old value')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'bulk…' }))
    await screen.findByText('1 keys selected')
    fireEvent.click(screen.getByLabelText('set null'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    expect(await screen.findByText('NULL')).toBeInTheDocument()
    expect(screen.getByText('explicit null state — GET answers 204')).toBeInTheDocument()
    expect(screen.queryByText('old value')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'null-key' })).toBeInTheDocument()
  })

  it('creates a new key via PUT with the given key and value, then selects it', async () => {
    let putBody: string | undefined
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(putBody !== undefined ? ['fresh:1'] : []))),
      http.put(keyUrl('fresh:1'), async ({ request }) => {
        putBody = await request.text()
        return new HttpResponse(null, { status: 200 })
      }),
      http.get(keyUrl('fresh:1'), () => rawValue('new value')),
    )
    await connectAndRender()
    await screen.findByText('no keys')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new key name'), { target: { value: 'fresh:1' } })
    expect(await screen.findByLabelText('new key value editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    await waitFor(() => expect(putBody).toBe(''))
    expect(await screen.findByText('KEY fresh:1')).toBeInTheDocument()
  })

  it('requires a key name before creating', async () => {
    server.use(http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan([]))))
    await connectAndRender()
    await screen.findByText('no keys')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('key is required')).toBeInTheDocument()
  })

  it('also invalidates the kv-count activity query on create and on delete, so dots/tags/sections can follow without reload (spec shell/004 §1, shell/010 §3)', async () => {
    let freshCreated = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(freshCreated ? ['existing', 'fresh:1'] : ['existing']))),
      http.get(keyUrl('existing'), () => rawValue('e')),
      http.put(keyUrl('fresh:1'), () => {
        freshCreated = true
        return new HttpResponse(null, { status: 200 })
      }),
      http.get(keyUrl('fresh:1'), () => rawValue('new value')),
      http.delete(keyUrl('existing'), () => new HttpResponse(null, { status: 204 })),
    )
    const { queryClient } = await connectAndRender()
    await screen.findByText('KEY existing')

    const probeKey = ['kv-count', DOMAIN]
    queryClient.setQueryData(probeKey, 1)
    expect(queryClient.getQueryState(probeKey)?.isInvalidated).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new key name'), { target: { value: 'fresh:1' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('KEY fresh:1')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(probeKey)?.isInvalidated).toBe(true))

    queryClient.setQueryData(probeKey, 2)
    expect(queryClient.getQueryState(probeKey)?.isInvalidated).toBe(false)

    fireEvent.click(await screen.findByRole('button', { name: 'existing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'delete — sure?' }))

    await waitFor(() => expect(queryClient.getQueryState(probeKey)?.isInvalidated).toBe(true))
  })

  it('shows live watch events colored by type, and debounced-invalidates the key list', async () => {
    let scanned = 0
    server.use(
      http.get(KEYS_URL, () => {
        scanned += 1
        return HttpResponse.json(kvKeyScan(scanned === 1 ? ['alpha'] : ['alpha', 'beta']))
      }),
      http.get(keyUrl('alpha'), () => rawValue('a')),
      watchStream(['event: set\ndata: beta\n\n', 'event: delete\ndata: alpha\n\n']),
    )
    await connectAndRender()
    await screen.findByText('alpha')

    fireEvent.click(screen.getByRole('button', { name: '● live' }))

    expect(await screen.findByText('beta')).toBeInTheDocument()
    expect(document.querySelector('.kv-feed__type--set')).toHaveTextContent('set')
    expect(document.querySelector('.kv-feed__type--delete')).toHaveTextContent('delete')

    await waitFor(() => expect(scanned).toBeGreaterThanOrEqual(2), { timeout: 2000 })
  })

  it(
    'ends the watch feed with a hint once the domain enters deleting (410) after being connected',
    async () => {
      let call = 0
      let closeStream: (() => void) | undefined
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['alpha']))),
        http.get(keyUrl('alpha'), () => rawValue('a')),
        http.get(WATCH_URL, () => {
          call += 1
          if (call === 1) {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                closeStream = () => controller.close()
              },
            })
            return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
          }
          return new HttpResponse(null, { status: 410 })
        }),
      )
      await connectAndRender()
      await screen.findByText('alpha')

      fireEvent.click(screen.getByRole('button', { name: '● live' }))
      await waitFor(() => expect(screen.getByText('live')).toBeInTheDocument())

      closeStream?.()

      await waitFor(() => expect(screen.getByText('domain is being deleted — watch ended')).toBeInTheDocument(), { timeout: 3000 })
    },
    10000,
  )

  it('sends ?ttl= on create only when a value is entered; empty stays unbefristet (no param)', async () => {
    let noTtlUrl: string | undefined
    let withTtlUrl: string | undefined
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan([]))),
      http.put(keyUrl('no-ttl'), async ({ request }) => {
        noTtlUrl = request.url
        return new HttpResponse(null, { status: 200 })
      }),
      http.get(keyUrl('no-ttl'), () => rawValue('v')),
      http.put(keyUrl('with-ttl'), async ({ request }) => {
        withTtlUrl = request.url
        return new HttpResponse(null, { status: 200 })
      }),
      http.get(keyUrl('with-ttl'), () => rawValue('v')),
    )
    await connectAndRender()
    await screen.findByText('no keys')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new key name'), { target: { value: 'no-ttl' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    await waitFor(() => expect(noTtlUrl).toBeDefined())
    expect(new URL(noTtlUrl!).searchParams.has('ttl')).toBe(false)

    fireEvent.click(await screen.findByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new key name'), { target: { value: 'with-ttl' } })
    fireEvent.change(screen.getByLabelText('ttl (seconds)'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    await waitFor(() => expect(withTtlUrl).toBeDefined())
    expect(new URL(withTtlUrl!).searchParams.get('ttl')).toBe('120')
  })

  it('rejects a non-positive-integer ttl on create without sending the request', async () => {
    let putCalled = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan([]))),
      http.put(keyUrl('fresh:1'), () => {
        putCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()
    await screen.findByText('no keys')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new key name'), { target: { value: 'fresh:1' } })
    fireEvent.change(screen.getByLabelText('ttl (seconds)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('ttl must be a positive integer (seconds)')).toBeInTheDocument()
    expect(putCalled).toBe(false)
  })

  it('edits a value with a ttl: PUT URL carries ?ttl= when entered', async () => {
    let lastUrl: string | undefined
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['raw-key']))),
      http.get(keyUrl('raw-key'), () => rawValue('hello')),
      http.put(keyUrl('raw-key'), async ({ request }) => {
        lastUrl = request.url
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    fireEvent.change(await screen.findByLabelText('ttl (seconds)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(lastUrl).toBeDefined())
    expect(new URL(lastUrl!).searchParams.get('ttl')).toBe('30')
  })

  it('rejects a non-positive-integer ttl on edit without sending the request, keeping the editor open', async () => {
    let putCalled = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['raw-key']))),
      http.get(keyUrl('raw-key'), () => rawValue('hello')),
      http.put(keyUrl('raw-key'), () => {
        putCalled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    fireEvent.change(await screen.findByLabelText('ttl (seconds)'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(await screen.findByText('ttl must be a positive integer (seconds)')).toBeInTheDocument()
    expect(putCalled).toBe(false)
    expect(await screen.findByLabelText('value editor')).toBeInTheDocument()
  })

  describe('ttl and key metadata in the detail (spec data/012)', () => {
    it('appends "expires in" and "modified … ago" from /meta (seconds vs. milliseconds) to the bytes line', async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['ttl-key']))),
        http.get(keyUrl('ttl-key'), () => rawValue('payload')),
        http.get(metaUrl('ttl-key'), () => HttpResponse.json({ expires_at: nowSecs + 601, last_modified_at: Date.now() - 120_500 })),
      )
      await connectAndRender()

      await screen.findByText('KEY ttl-key')
      await waitFor(() => expect(metaLine()).toBe('7 bytes · expires in 10m · modified 2m ago'))
    })

    it('shows no expiry segment for a key without ttl, but still the modification age', async () => {
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['plain']))),
        http.get(keyUrl('plain'), () => rawValue('payload')),
        http.get(metaUrl('plain'), () => HttpResponse.json({ expires_at: null, last_modified_at: Date.now() - 5 * 3600_000 - 3 * 60_000 - 500 })),
      )
      await connectAndRender()

      await screen.findByText('KEY plain')
      await waitFor(() => expect(metaLine()).toBe('7 bytes · modified 5h 3m ago'))
      expect(metaLine()).not.toContain('expires')
    })

    it('says "expired" once expires_at lies in the past', async () => {
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['stale']))),
        http.get(keyUrl('stale'), () => rawValue('payload')),
        http.get(metaUrl('stale'), () => HttpResponse.json({ expires_at: Math.floor(Date.now() / 1000) - 5, last_modified_at: Date.now() - 1000 })),
      )
      await connectAndRender()

      await screen.findByText('KEY stale')
      await waitFor(() => expect(metaLine()).toBe('7 bytes · expired · modified 1s ago'))
    })

    it('leaves the line exactly as before when /meta answers 404 — no placeholder, no error', async () => {
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['raced']))),
        http.get(keyUrl('raced'), () => rawValue('payload')),
        http.get(metaUrl('raced'), () => HttpResponse.text("404 Not Found: key 'raced' not found", { status: 404 })),
      )
      const { queryClient } = await connectAndRender()

      await screen.findByText('KEY raced')
      await waitFor(() => expect(queryClient.getQueryState(['kv-meta', DOMAIN, 'raced'])?.status).toBe('success'))
      expect(metaLine()).toBe('7 bytes')
      expect(screen.queryByText(/not found/)).not.toBeInTheDocument()
    })

    it('appends only the modification age to the null-state line, never an expiry segment', async () => {
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['nulled']))),
        http.get(keyUrl('nulled'), () => new HttpResponse(null, { status: 204 })),
        http.get(metaUrl('nulled'), () => HttpResponse.json({ expires_at: Math.floor(Date.now() / 1000) + 600, last_modified_at: Date.now() - 42_500 })),
      )
      await connectAndRender()

      await screen.findByText('NULL')
      await waitFor(() => expect(metaLine()).toBe('explicit null state — GET answers 204 · modified 42s ago'))
    })

    it('re-scanning with unchanged filters refetches the metadata of the open key as well (spec data/012 §4)', async () => {
      let metaReads = 0
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['meta-key']))),
        http.get(keyUrl('meta-key'), () => rawValue('payload')),
        http.get(metaUrl('meta-key'), () => {
          metaReads += 1
          return HttpResponse.json({ expires_at: null, last_modified_at: Date.now() })
        }),
      )
      await connectAndRender()
      await screen.findByText('KEY meta-key')
      await waitFor(() => expect(metaReads).toBe(1))

      fireEvent.click(screen.getByRole('button', { name: 'Scan' }))

      await waitFor(() => expect(metaReads).toBe(2))
    })

    it('refetches the metadata after save and after set null, and drops the cache entry after delete', async () => {
      let metaReads = 0
      server.use(
        http.get(KEYS_URL, () => HttpResponse.json(kvKeyScan(['meta-key']))),
        http.get(keyUrl('meta-key'), () => rawValue('payload')),
        http.get(metaUrl('meta-key'), () => {
          metaReads += 1
          return HttpResponse.json({ expires_at: null, last_modified_at: Date.now() })
        }),
        http.put(keyUrl('meta-key'), () => new HttpResponse(null, { status: 200 })),
        http.patch(`${keyUrl('meta-key')}/null`, () => new HttpResponse(null, { status: 200 })),
        http.delete(keyUrl('meta-key'), () => new HttpResponse(null, { status: 204 })),
      )
      const { queryClient } = await connectAndRender()
      await screen.findByText('KEY meta-key')
      await waitFor(() => expect(metaReads).toBe(1))

      fireEvent.click(screen.getByRole('button', { name: 'edit' }))
      await screen.findByLabelText('value editor')
      fireEvent.click(screen.getByRole('button', { name: 'save' }))
      await waitFor(() => expect(metaReads).toBe(2))

      fireEvent.click(await screen.findByRole('button', { name: 'set null' }))
      fireEvent.click(await screen.findByRole('button', { name: 'set null — sure?' }))
      await waitFor(() => expect(metaReads).toBe(3))

      fireEvent.click(await screen.findByRole('button', { name: 'delete' }))
      fireEvent.click(await screen.findByRole('button', { name: 'delete — sure?' }))
      await waitFor(() => expect(queryClient.getQueryState(['kv-meta', DOMAIN, 'meta-key'])).toBeUndefined())
    })
  })
})

