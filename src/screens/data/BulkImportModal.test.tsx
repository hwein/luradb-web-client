import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { BulkImportForm } from './BulkImportModal'

const ORIGIN = window.location.origin
const DOMAIN = 'shop'
const BULK_URL = `${ORIGIN}/store-api/json/${DOMAIN}/bulk`

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function Harness({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <BulkImportForm domain={DOMAIN} apiClient={apiClient} onClose={onClose} />
}

/** Rendert `BulkImportForm` ohne die native `<dialog>`-Hülle (showModal() ist in diesem jsdom nicht implementiert). */
async function renderForm(onClose: () => void = () => {}) {
  server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })))
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Harness onClose={onClose} />
    </QueryClientProvider>,
  )
  await screen.findByText('bulk import · shop')
  return { ...result, queryClient }
}

afterEach(() => {
  act(() => disconnect())
})

describe('BulkImportForm', () => {
  it('shows the summary and invalidates the document list + domain detail caches on success', async () => {
    server.use(http.post(BULK_URL, () => HttpResponse.json({ imported: 2, failed: 0, errors: [] })))
    const { queryClient } = await renderForm()
    const docsKey = ['json-documents', DOMAIN]
    const detailKey = ['json-domain-detail', DOMAIN]
    queryClient.setQueryData(docsKey, { pages: [], pageParams: [] })
    queryClient.setQueryData(detailKey, { name: DOMAIN })

    fireEvent.change(screen.getByLabelText('ndjson input'), { target: { value: '{"_key":"a"}\n{"_key":"b"}\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    expect(await screen.findByText(/imported 2/)).toBeInTheDocument()
    expect(screen.getByText('failed 0')).not.toHaveClass('bim__summary-failed')
    await waitFor(() => expect(queryClient.getQueryState(docsKey)?.isInvalidated).toBe(true))
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true)
  })

  it('disables the button and shows "importing…" while the request is in flight', async () => {
    let resolveImport: (() => void) | undefined
    server.use(
      http.post(BULK_URL, async () => {
        await new Promise<void>((resolve) => {
          resolveImport = resolve
        })
        return HttpResponse.json({ imported: 1, failed: 0, errors: [] })
      }),
    )
    await renderForm()

    fireEvent.change(screen.getByLabelText('ndjson input'), { target: { value: '{"_key":"a"}\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    expect(await screen.findByRole('button', { name: 'importing…' })).toBeDisabled()
    resolveImport?.()

    await waitFor(() => expect(screen.getByRole('button', { name: 'import' })).not.toBeDisabled())
  })

  it('renders both key- and "line N"-style error entries from a partial success, and still invalidates (imported > 0)', async () => {
    server.use(
      http.post(BULK_URL, () =>
        HttpResponse.json({
          imported: 2,
          failed: 2,
          errors: [
            { key: 'line 3', error: 'invalid JSON: expected ident at line 1 column 2' },
            { key: 'dup_key', error: 'duplicate key' },
          ],
        }),
      ),
    )
    const { queryClient } = await renderForm()
    const docsKey = ['json-documents', DOMAIN]
    queryClient.setQueryData(docsKey, { pages: [], pageParams: [] })

    fireEvent.change(screen.getByLabelText('ndjson input'), { target: { value: '{"_key":"a"}\n{"_key":"b"}\nnot-json\n{"_key":"dup_key"}\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    expect(await screen.findByText('failed 2')).toHaveClass('bim__summary-failed')
    expect(screen.getByText('line 3 · invalid JSON: expected ident at line 1 column 2')).toBeInTheDocument()
    expect(screen.getByText('dup_key · duplicate key')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(docsKey)?.isInvalidated).toBe(true))
  })

  it('does not invalidate caches when the response keeps imported at 0', async () => {
    server.use(
      http.post(BULK_URL, () => HttpResponse.json({ imported: 0, failed: 1, errors: [{ key: 'line 1', error: 'invalid JSON' }] })),
    )
    const { queryClient } = await renderForm()
    const docsKey = ['json-documents', DOMAIN]
    queryClient.setQueryData(docsKey, { pages: [], pageParams: [] })

    fireEvent.change(screen.getByLabelText('ndjson input'), { target: { value: 'not-json\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    expect(await screen.findByText('failed 1')).toBeInTheDocument()
    expect(queryClient.getQueryState(docsKey)?.isInvalidated).toBe(false)
  })

  it('shows a 404 inline with the original server text (domain not found)', async () => {
    server.use(http.post(BULK_URL, () => new HttpResponse("domain 'shop' not found", { status: 404 })))
    await renderForm()

    fireEvent.change(screen.getByLabelText('ndjson input'), { target: { value: '{"_key":"a"}\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'import' }))

    expect(await screen.findByText("domain 'shop' not found")).toBeInTheDocument()
  })

  it('"load file…" reads the file into the textarea and updates the line counter', async () => {
    await renderForm()
    expect(screen.getByText('0 lines')).toBeInTheDocument()

    const file = new File(['{"_key":"a"}\n{"_key":"b"}\n'], 'dump.ndjson', { type: 'application/x-ndjson' })
    fireEvent.change(screen.getByLabelText('load file…'), { target: { files: [file] } })

    await waitFor(() => expect(screen.getByLabelText('ndjson input')).toHaveValue('{"_key":"a"}\n{"_key":"b"}\n'))
    expect(screen.getByText('2 lines')).toBeInTheDocument()
  })

  it('closes via the close button', async () => {
    const onClose = vi.fn()
    await renderForm(onClose)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
