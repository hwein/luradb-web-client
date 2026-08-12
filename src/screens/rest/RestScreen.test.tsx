import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect } from '../../app/session'
import { resetReindexTasks, useReindexTasks } from '../../lib'
import { SelectedDomainProvider } from '../../shell/SelectedDomainContext'
import { server } from '../../test/msw'
import { RestScreen } from './RestScreen'

const ORIGIN = window.location.origin

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
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'default', created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
  ]
}

function TasksProbe() {
  const tasks = useReindexTasks()
  return <p data-testid="tasks-probe">{tasks.map((task) => `${task.domain}:${task.taskId}:${task.status.kind}`).join(',')}</p>
}

async function connectAndRender() {
  server.use(...baseHandlers())
  await act(() => connect(makeConnection()))

  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedDomainProvider>
          <RestScreen />
          <TasksProbe />
        </SelectedDomainProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function responseBody(container: HTMLElement): string {
  return container.querySelector('.rest__response-body')?.textContent ?? ''
}

afterEach(() => {
  act(() => disconnect())
  resetReindexTasks()
})

describe('RestScreen', () => {
  it('lists contract endpoints grouped by tag, with base-path-stripped display paths', async () => {
    await connectAndRender()

    expect(await screen.findByText('Key-Value Store')).toBeInTheDocument()
    expect(screen.getByText('JSON Document Store')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GET /kv/{domain}/keys/{key}' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'POST /json/{domain}/search' })).toBeInTheDocument()
  })

  it('sends the default request and renders status line and pretty body', async () => {
    const { container } = await connectAndRender()

    expect(screen.getByLabelText('request url')).toHaveValue('/store-api/domains')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('200')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(responseBody(container)).toContain('"name": "default"')
  })

  it('prefills {domain} from the selected domain, substitutes params, and shows the response', async () => {
    const { container } = await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'GET /kv/{domain}/keys/{key}' }))

    const domainInput = await screen.findByLabelText('path parameter domain')
    await waitFor(() => expect(domainInput).toHaveValue('default'))
    fireEvent.change(screen.getByLabelText('path parameter key'), { target: { value: 'test' } })

    let hitUrl = ''
    server.use(
      http.get(`${ORIGIN}/store-api/kv/default/keys/test`, ({ request }) => {
        hitUrl = new URL(request.url).pathname
        return new HttpResponse('cart-value', { headers: { 'content-type': 'application/octet-stream' } })
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('200')).toBeInTheDocument()
    expect(hitUrl).toBe('/store-api/kv/default/keys/test')
    // Nicht-JSON-Content-Type -> Rohtext.
    expect(responseBody(container)).toBe('cart-value')
  })

  it('renders error responses with their status and body, not as a thrown error', async () => {
    const { container } = await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'GET /kv/{domain}/keys/{key}' }))
    await waitFor(() => expect(screen.getByLabelText('path parameter domain')).toHaveValue('default'))
    fireEvent.change(screen.getByLabelText('path parameter key'), { target: { value: 'missing' } })

    server.use(
      http.get(`${ORIGIN}/store-api/kv/default/keys/missing`, () => HttpResponse.json({ error: 'key not found' }, { status: 404 })),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(screen.getByText('Not Found')).toBeInTheDocument()
    expect(responseBody(container)).toContain('key not found')
  })

  it('copy as curl emits the placeholder, never the real key', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await connectAndRender()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('OK')

    fireEvent.click(screen.getByText('copy as curl'))

    expect(writeText).toHaveBeenCalledTimes(1)
    const curl = writeText.mock.calls[0]?.[0] as string
    expect(curl).toContain('-H "Authorization: Bearer $LURADB_KEY"')
    expect(curl).not.toContain('lura_secret')
    expect(await screen.findByText('copied ✓')).toBeInTheDocument()
  })

  it('arms destructive requests: first Send confirms, second sends', async () => {
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'DELETE /kv/{domain}/keys/{key}' }))
    await waitFor(() => expect(screen.getByLabelText('path parameter domain')).toHaveValue('default'))
    fireEvent.change(screen.getByLabelText('path parameter key'), { target: { value: 'test' } })

    let deletes = 0
    server.use(
      http.delete(`${ORIGIN}/store-api/kv/default/keys/test`, () => {
        deletes += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('button', { name: 'send DELETE — sure?' })).toBeInTheDocument()
    expect(deletes).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'send DELETE — sure?' }))
    expect(await screen.findByText('204')).toBeInTheDocument()
    expect(deletes).toBe(1)
  })

  it('disarms the destructive guard when the endpoint changes', async () => {
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'DELETE /kv/{domain}/keys/{key}' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('button', { name: 'send DELETE — sure?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'GET /kv/{domain}/keys/{key}' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'send DELETE — sure?' })).not.toBeInTheDocument()
  })

  it('registers a client-started task (spec engines/001) on a successful reindex POST, for the Engines screen to pick up', async () => {
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'POST /json/{domain}/reindex' }))
    // Explizit tippen statt auf die Context-Vorbelegung zu bauen — deren Effect-Timing ist unter Last nicht deterministisch.
    fireEvent.change(screen.getByLabelText('path parameter domain'), { target: { value: 'default' } })

    server.use(http.post(`${ORIGIN}/store-api/json/default/reindex`, () => HttpResponse.json({ task_id: 'task_9f1' }, { status: 202 })))

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('202')).toBeInTheDocument()
    expect(await screen.findByTestId('tasks-probe')).toHaveTextContent('default:task_9f1:running')
  })

  it('does not register a task for a POST to a different endpoint (no task_id in the response)', async () => {
    await connectAndRender()

    fireEvent.click(await screen.findByRole('button', { name: 'POST /json/{domain}/search' }))
    fireEvent.change(screen.getByLabelText('path parameter domain'), { target: { value: 'default' } })
    server.use(
      http.post(`${ORIGIN}/store-api/json/default/search`, () => HttpResponse.json({ documents: [], limit: 50, offset: 0, total: 0 })),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('200')).toBeInTheDocument()
    expect(screen.getByTestId('tasks-probe')).toHaveTextContent('')
  })
})
