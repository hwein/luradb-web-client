import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { server } from '../../test/msw'
import { UsersCard } from './UsersCard'

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

function ConnectedUsersCard() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  return <UsersCard apiClient={apiClient} />
}

function renderConnected() {
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectedUsersCard />
    </QueryClientProvider>,
  )
}

/** Ein einzelner kv-Domain "shop" für jeden Test — reicht für Spalten- und Zell-Zyklus-Assertions. */
function domainHandlers() {
  return [
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([{ name: 'shop', created_at: 1 }])),
    http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
    http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
  ]
}

function versionHandler() {
  return http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' }))
}

afterEach(() => {
  act(() => disconnect())
})

describe('UsersCard', () => {
  it('renders a domain column per explorer domain; admin gets a badge + non-clickable "all" cells, a regular user gets "?" cells', async () => {
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () =>
        HttpResponse.json([
          { name: 'admin', role: 'Admin', created_at: 1 },
          { name: 'shop-svc', role: 'User', created_at: 2 },
        ]),
      ),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    expect(await screen.findByText('shop')).toBeInTheDocument()

    const userItem = screen.getByText('shop-svc').closest('.admin-users__item') as HTMLElement
    const userCell = userItem.querySelector('.admin-users__cell') as HTMLButtonElement
    expect(userCell.textContent).toBe('?')

    const adminItem = document.querySelector('.admin-users__badge-admin')?.closest('.admin-users__item') as HTMLElement
    expect(adminItem).not.toBeNull()
    expect(adminItem.querySelectorAll('.admin-users__cell--all')).toHaveLength(1)
    expect(adminItem.querySelector('.admin-users__cell')).not.toBeInTheDocument()
    expect(within(adminItem).getByRole('button', { name: 'rotate key' })).toBeInTheDocument()
  })

  it('cycles a cell read → read+write → — → read, one POST/DELETE per click, committing the chip only on success', async () => {
    const calls: { method: string; body?: unknown; storeType?: string | null }[] = []
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([{ name: 'shop-svc', role: 'User', created_at: 1 }])),
      http.post(`${ORIGIN}/store-api/auth/users/shop-svc/permissions`, async ({ request }) => {
        calls.push({ method: 'POST', body: await request.json() })
        return new HttpResponse(null, { status: 200 })
      }),
      http.delete(`${ORIGIN}/store-api/auth/users/shop-svc/permissions/shop`, ({ request }) => {
        calls.push({ method: 'DELETE', storeType: new URL(request.url).searchParams.get('store_type') })
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const row = (await screen.findByText('shop-svc')).closest('.admin-users__item') as HTMLElement
    const cell = row.querySelector('.admin-users__cell') as HTMLButtonElement
    expect(cell.textContent).toBe('?')

    fireEvent.click(cell)
    await waitFor(() => expect(cell.textContent).toBe('read'))
    expect(calls[0]).toEqual({ method: 'POST', body: { domain: 'shop', access: 'read', store_type: 'kv' } })

    fireEvent.click(cell)
    await waitFor(() => expect(cell.textContent).toBe('read+write'))
    expect(calls[1]).toEqual({ method: 'POST', body: { domain: 'shop', access: 'write', store_type: 'kv' } })

    fireEvent.click(cell)
    await waitFor(() => expect(cell.textContent).toBe('—'))
    expect(calls[2]).toEqual({ method: 'DELETE', storeType: 'kv' })

    fireEvent.click(cell)
    await waitFor(() => expect(cell.textContent).toBe('read'))
    expect(calls[3]).toEqual({ method: 'POST', body: { domain: 'shop', access: 'read', store_type: 'kv' } })
  })

  it('a failed permission POST leaves the cell at its previous value and shows a red inline error', async () => {
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([{ name: 'shop-svc', role: 'User', created_at: 1 }])),
      http.post(`${ORIGIN}/store-api/auth/users/shop-svc/permissions`, () => new HttpResponse(null, { status: 500 })),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const row = (await screen.findByText('shop-svc')).closest('.admin-users__item') as HTMLElement
    const cell = row.querySelector('.admin-users__cell') as HTMLButtonElement
    expect(cell.textContent).toBe('?')

    fireEvent.click(cell)
    await waitFor(() => expect(row.querySelector('.admin-users__cell-error')).toBeInTheDocument())
    expect(cell.textContent).toBe('?')
    expect(row.querySelector('.admin-users__cell-error')?.textContent).toContain('500')
  })

  it('rotate key: arms a confirm, reveals the new key once with a copy button, and clears it on window blur', async () => {
    const clipboardWrites: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void clipboardWrites.push(text) },
      configurable: true,
    })
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([{ name: 'shop-svc', role: 'User', created_at: 1 }])),
      http.post(`${ORIGIN}/store-api/auth/users/shop-svc/rotate-key`, () =>
        HttpResponse.json({ api_key: 'lura_fake_rotated_test_key', name: 'shop-svc' }),
      ),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const row = (await screen.findByText('shop-svc')).closest('.admin-users__item') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'rotate key' }))
    expect(await within(row).findByRole('button', { name: 'confirm' })).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'confirm' }))

    expect(await within(row).findByText('lura_fake_rotated_test_key')).toBeInTheDocument()
    expect(within(row).getByText('shown once — store it now')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'copy' }))
    expect(clipboardWrites).toEqual(['lura_fake_rotated_test_key'])

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(within(row).queryByText('lura_fake_rotated_test_key')).not.toBeInTheDocument()
  })

  it('creates a user, reveals the key once, and shows a 409 inline without losing the typed name', async () => {
    let createCalls = 0
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])),
      http.post(`${ORIGIN}/store-api/auth/users`, async ({ request }) => {
        createCalls += 1
        const body = (await request.json()) as { name: string }
        if (body.name === 'taken') return new HttpResponse(null, { status: 409 })
        return HttpResponse.json({ api_key: 'lura_fake_created_test_key', name: body.name, role: 'User' }, { status: 201 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const input = await screen.findByPlaceholderText('new user (max 50 chars, [a-zA-Z0-9_-])')
    fireEvent.change(input, { target: { value: 'fresh-user' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('lura_fake_created_test_key')).toBeInTheDocument()
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: 'taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText(/409/)).toBeInTheDocument()
    expect(input).toHaveValue('taken')
    expect(createCalls).toBe(2)
  })

  it('deletes a user after a confirm step and removes the row once the list is invalidated', async () => {
    let usersState: { name: string; role: string; created_at: number }[] = [{ name: 'shop-svc', role: 'User', created_at: 1 }]
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json(usersState)),
      http.delete(`${ORIGIN}/store-api/auth/users/shop-svc`, () => {
        usersState = []
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('shop-svc')
    fireEvent.click(screen.getByTitle('delete user'))
    fireEvent.click(await screen.findByRole('button', { name: 'confirm' }))

    await waitFor(() => expect(screen.queryByText('shop-svc')).not.toBeInTheDocument())
  })

  it('forgets cell state on remount (page reload) — a "read" cell goes back to "?"', async () => {
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([{ name: 'shop-svc', role: 'User', created_at: 1 }])),
      http.post(`${ORIGIN}/store-api/auth/users/shop-svc/permissions`, () => new HttpResponse(null, { status: 200 })),
    )
    await act(() => connect(makeConnection()))
    const { unmount } = renderConnected()

    const row1 = (await screen.findByText('shop-svc')).closest('.admin-users__item') as HTMLElement
    const cell1 = row1.querySelector('.admin-users__cell') as HTMLButtonElement
    fireEvent.click(cell1)
    await waitFor(() => expect(cell1.textContent).toBe('read'))

    unmount()
    renderConnected()

    const row2 = (await screen.findByText('shop-svc')).closest('.admin-users__item') as HTMLElement
    const cell2 = row2.querySelector('.admin-users__cell') as HTMLButtonElement
    expect(cell2.textContent).toBe('?')
  })
})
