import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { server } from '../../test/msw'
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
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: DOMAIN, created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
  ]
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

async function connectAndRender() {
  server.use(...baseHandlers())
  await act(() => connect(makeConnection()))
  const queryClient = createAppQueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/data?engine=kv']}>
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

afterEach(() => {
  act(() => disconnect())
})

describe('KvBrowser', () => {
  it('scans keys via GET and shows the call in the footer; Scan commits a new prefix', async () => {
    let lastPrefix: string | null = null
    server.use(
      http.get(KEYS_URL, ({ request }) => {
        lastPrefix = new URL(request.url).searchParams.get('prefix')
        return HttpResponse.json(lastPrefix === 'cart:' ? ['cart:1', 'cart:2'] : ['alpha', 'beta'])
      }),
      http.get(keyUrl('alpha'), () => rawValue('a')),
      http.get(keyUrl('cart:1'), () => rawValue('c')),
    )
    await connectAndRender()

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain('2 keys'))
    expect(footerText()).toContain(`GET /store-api/kv/${DOMAIN}/keys`)
    expect(footerText()).toContain('limit 100')
    expect(footerText()).not.toContain('prefix=')

    fireEvent.change(screen.getByLabelText('key prefix'), { target: { value: 'cart:' } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }))

    await waitFor(() => expect(lastPrefix as string | null).toBe('cart:'))
    expect(await screen.findByText('cart:1')).toBeInTheDocument()
    await waitFor(() => expect(footerText()).toContain(`GET /store-api/kv/${DOMAIN}/keys?prefix=cart%3A`))
  })

  it('reveals more of the already-fetched keys on "load more", without a second network request', async () => {
    let scanCalls = 0
    const allKeys = Array.from({ length: 150 }, (_, i) => `k${String(i).padStart(3, '0')}`)
    server.use(
      http.get(KEYS_URL, () => {
        scanCalls += 1
        return HttpResponse.json(allKeys)
      }),
      http.get(`${KEYS_URL}/:key`, () => rawValue('v')),
    )
    await connectAndRender()

    await screen.findByText('k000')
    await waitFor(() => expect(footerText()).toContain('150 keys'))
    expect(screen.getByText('k099')).toBeInTheDocument()
    expect(screen.queryByText('k100')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'load more' }))

    expect(await screen.findByText('k149')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'load more' })).not.toBeInTheDocument()
    expect(scanCalls).toBe(1)
  })

  it('opens the bulk panel from "bulk…", based on the full scan result rather than the 100-key page cap (spec data/008 §2)', async () => {
    const allKeys = Array.from({ length: 150 }, (_, i) => `k${String(i).padStart(3, '0')}`)
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(allKeys)),
      http.get(`${KEYS_URL}/:key`, () => rawValue('v')),
    )
    await connectAndRender()
    await screen.findByText('k000')

    expect(screen.queryByText(/keys scanned/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'bulk…' }))

    expect(document.querySelector('.kv-bulk__scope')?.textContent).toContain('150 keys scanned (prefix "")')
  })

  it('shows JSON pretty-print, plaintext, and an empty value as a plain 0-bytes value (no special state)', async () => {
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(['json-key', 'plain-key', 'empty-key'])),
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
      http.get(KEYS_URL, () => HttpResponse.json(['raw-key'])),
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

  it('arms and confirms "set null": PATCHes …/null; today the server tombstones the key, so it vanishes like a delete', async () => {
    let nulled = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(nulled ? [] : ['tomb-key'])),
      http.get(keyUrl('tomb-key'), () => (nulled ? new HttpResponse('not found', { status: 404 }) : rawValue('value'))),
      http.patch(`${keyUrl('tomb-key')}/null`, () => {
        nulled = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'set null' }))
    fireEvent.click(await screen.findByRole('button', { name: 'set null — sure?' }))

    await waitFor(() => expect(screen.queryByText('tomb-key')).not.toBeInTheDocument())
    expect(screen.getByText('no keys')).toBeInTheDocument()
    expect(screen.getByText('select a key')).toBeInTheDocument()
  })

  it('re-scanning with an unchanged prefix refetches: a key that expired server-side vanishes from list and detail', async () => {
    let expired = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(expired ? [] : ['zombie'])),
      http.get(keyUrl('zombie'), () => rawValue('z')),
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
      http.get(KEYS_URL, () => HttpResponse.json(expired ? [] : ['ttl-key'])),
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
      http.get(KEYS_URL, () => HttpResponse.json(deleted ? [] : ['gone-key'])),
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
      http.get(KEYS_URL, () => HttpResponse.json(deleted ? [] : ['tomb-key'])),
      http.get(keyUrl('tomb-key'), () => rawValue('bye')),
      http.delete(keyUrl('tomb-key'), () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await connectAndRender()
    await screen.findByText('KEY tomb-key')

    fireEvent.click(screen.getByRole('button', { name: 'bulk…' }))
    fireEvent.click(screen.getByLabelText('delete'))
    fireEvent.click(screen.getByRole('button', { name: 'run…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'run' }))

    await waitFor(() => expect(screen.queryByText('tomb-key')).not.toBeInTheDocument())
    expect(await screen.findByText('select a key')).toBeInTheDocument()
  })

  it('creates a new key via PUT with the given key and value, then selects it', async () => {
    let putBody: string | undefined
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(putBody !== undefined ? ['fresh:1'] : [])),
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
    server.use(http.get(KEYS_URL, () => HttpResponse.json([])))
    await connectAndRender()
    await screen.findByText('no keys')

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('key is required')).toBeInTheDocument()
  })

  it('also invalidates the kv-keys-probe activity query on create and on delete, so dots/tags/sections can follow without reload (spec shell/004 §1)', async () => {
    let freshCreated = false
    server.use(
      http.get(KEYS_URL, () => HttpResponse.json(freshCreated ? ['existing', 'fresh:1'] : ['existing'])),
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

    const probeKey = ['kv-keys-probe', DOMAIN]
    queryClient.setQueryData(probeKey, ['existing'])
    expect(queryClient.getQueryState(probeKey)?.isInvalidated).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '+ new' }))
    fireEvent.change(screen.getByLabelText('new key name'), { target: { value: 'fresh:1' } })
    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    expect(await screen.findByText('KEY fresh:1')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(probeKey)?.isInvalidated).toBe(true))

    queryClient.setQueryData(probeKey, ['existing', 'fresh:1'])
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
        return HttpResponse.json(scanned === 1 ? ['alpha'] : ['alpha', 'beta'])
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
        http.get(KEYS_URL, () => HttpResponse.json(['alpha'])),
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
      http.get(KEYS_URL, () => HttpResponse.json([])),
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
      http.get(KEYS_URL, () => HttpResponse.json([])),
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
      http.get(KEYS_URL, () => HttpResponse.json(['raw-key'])),
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
      http.get(KEYS_URL, () => HttpResponse.json(['raw-key'])),
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
})
