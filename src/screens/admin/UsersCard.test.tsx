import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../../app/connections'
import { createAppQueryClient } from '../../app/queryClient'
import { connect, disconnect, useSession } from '../../app/session'
import { domainResponse, server } from '../../test/msw'
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

/** A single domain "shop" for every test — enough for the column and cell-cycle assertions. */
function domainHandlers() {
  return [
    http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([domainResponse('shop')])),
  ]
}

function versionHandler() {
  return http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' }))
}

function domainsHandler(...names: string[]) {
  return http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json(names.map((name) => domainResponse(name))))
}

interface Grant {
  domain: string
  access: string
  engine?: string | null
}

interface PermissionCall {
  method: 'POST' | 'DELETE'
  path: string
  search: string
  body?: unknown
}

const ENGINES = ['kv', 'json', 'rel']

/** Keeps the stored grants of one user like the server (measured 2026-11-11): an engine grant or revoke splits a whole-domain grant. */
function permissionServer(name: string, initial: Grant[]) {
  const state: { permissions: Grant[]; calls: PermissionCall[]; hold?: Promise<void> } = { permissions: initial, calls: [] }

  function partsOf(domain: string): Grant[] {
    const onDomain = state.permissions.filter((grant) => grant.domain === domain)
    const whole = onDomain.find((grant) => !grant.engine)
    return whole ? ENGINES.map((engine) => ({ domain, engine, access: whole.access })) : onDomain
  }

  function others(domain: string): Grant[] {
    return state.permissions.filter((grant) => grant.domain !== domain)
  }

  const handlers = [
    http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([{ name, role: 'User', created_at: 1, permissions: state.permissions }])),
    http.post(`${ORIGIN}/store-api/auth/users/${name}/permissions`, async ({ request }) => {
      const url = new URL(request.url)
      const body = (await request.json()) as Grant
      state.calls.push({ method: 'POST', path: url.pathname, search: url.search, body })
      await state.hold
      state.permissions = body.engine
        ? [...others(body.domain), ...partsOf(body.domain).filter((grant) => grant.engine !== body.engine), body]
        : [...others(body.domain), body]
      return new HttpResponse(null, { status: 200 })
    }),
    http.delete(`${ORIGIN}/store-api/auth/users/${name}/permissions/:domain`, async ({ request, params }) => {
      const url = new URL(request.url)
      const domain = String(params.domain)
      const engine = url.searchParams.get('engine')
      state.calls.push({ method: 'DELETE', path: url.pathname, search: url.search })
      await state.hold
      state.permissions = engine
        ? [...others(domain), ...partsOf(domain).filter((grant) => grant.engine !== engine)]
        : others(domain)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { state, handlers }
}

/** LuraDB answers errors with one plaintext line. */
function plaintext(status: number, body: string): HttpResponse<string> {
  return new HttpResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function chip(label: string): HTMLButtonElement {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement
}

afterEach(() => {
  act(() => disconnect())
})

describe('UsersCard', () => {
  it('renders a whole-domain chip and three part chips per domain with the levels from the user list', async () => {
    const { handlers } = permissionServer('alice', [
      { domain: 'shop', access: 'write' },
      { domain: 'logs', engine: 'json', access: 'read' },
    ])
    server.use(versionHandler(), domainsHandler('shop', 'logs'), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    expect(chip('alice · shop').textContent).toBe('read+write')
    for (const engine of ENGINES) {
      const part = chip(`alice · shop · ${engine}`)
      expect(part.textContent).toBe('read+write')
      expect(part).toHaveClass('admin-users__cell--inherited')
      expect(part.querySelector(`.admin-users__dot--${engine}`)).toBeInTheDocument()
    }
    expect(chip('alice · logs').textContent).toBe('per part')
    expect(chip('alice · logs')).toBeDisabled()
    expect(chip('alice · logs · json').textContent).toBe('read')
    expect(chip('alice · logs · kv').textContent).toBe('—')
    expect(chip('alice · logs · rel').textContent).toBe('—')

    const card = document.querySelector('.admin-users') as HTMLElement
    expect(card.textContent).not.toMatch(/\?/)
    const footnote = card.querySelector('.admin-card__footnote') as HTMLElement
    expect(footnote.textContent).toContain('click a chip to cycle read · read+write · — · top chip: whole domain, below: keys, documents, tables')
    expect(footnote.textContent).toContain(
      'GET /store-api/auth/users · POST|DELETE /store-api/auth/users/{name}/permissions · new key shown once after rotate/create',
    )
  })

  it('renders a domain column per domain; an admin gets a badge and non-clickable "all" cells, a regular user gets "—" chips', async () => {
    server.use(
      versionHandler(),
      domainsHandler('shop', 'logs'),
      http.get(`${ORIGIN}/store-api/auth/users`, () =>
        HttpResponse.json([
          { name: 'admin', role: 'Admin', created_at: 1, permissions: [] },
          { name: 'shop-svc', role: 'User', created_at: 2, permissions: [] },
        ]),
      ),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    expect(await screen.findByText('shop')).toBeInTheDocument()
    expect(screen.getByText('logs')).toBeInTheDocument()

    const userItem = screen.getByText('shop-svc').closest('.admin-users__item') as HTMLElement
    const userChips = userItem.querySelectorAll('.admin-users__cell')
    expect(userChips).toHaveLength(8)
    for (const userChip of userChips) expect(userChip.textContent).toBe('—')

    const adminItem = document.querySelector('.admin-users__badge-admin')?.closest('.admin-users__item') as HTMLElement
    expect(adminItem).not.toBeNull()
    expect(adminItem.querySelectorAll('.admin-users__cell--all')).toHaveLength(2)
    expect(adminItem.querySelector('.admin-users__cell')).not.toBeInTheDocument()
    expect(within(adminItem).getByRole('button', { name: 'rotate key' })).toBeInTheDocument()
  })

  it('cycles the whole-domain chip — → read → read+write → —: one POST or DELETE without engine per click, the chip follows the reloaded user list', async () => {
    const { state, handlers } = permissionServer('alice', [])
    server.use(versionHandler(), ...domainHandlers(), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    expect(chip('alice · shop').textContent).toBe('—')

    let release = (): void => undefined
    state.hold = new Promise((resolve) => {
      release = () => resolve()
    })
    fireEvent.click(chip('alice · shop'))
    await waitFor(() => expect(chip('alice · shop')).toBeDisabled())
    release()
    state.hold = undefined
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('read'))
    expect(chip('alice · shop')).toBeEnabled()
    expect(state.calls).toEqual([{ method: 'POST', path: '/store-api/auth/users/alice/permissions', search: '', body: { domain: 'shop', access: 'read' } }])

    fireEvent.click(chip('alice · shop'))
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('read+write'))
    expect(state.calls).toHaveLength(2)
    expect(state.calls[1]).toEqual({ method: 'POST', path: '/store-api/auth/users/alice/permissions', search: '', body: { domain: 'shop', access: 'write' } })

    fireEvent.click(chip('alice · shop'))
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('—'))
    expect(state.calls).toHaveLength(3)
    expect(state.calls[2]).toEqual({ method: 'DELETE', path: '/store-api/auth/users/alice/permissions/shop', search: '' })
  })

  it("cycles a part chip with the chip's engine: POST with engine, DELETE with ?engine=", async () => {
    const { state, handlers } = permissionServer('alice', [])
    server.use(versionHandler(), ...domainHandlers(), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    fireEvent.click(chip('alice · shop · json'))
    await waitFor(() => expect(chip('alice · shop · json').textContent).toBe('read'))
    expect(chip('alice · shop').textContent).toBe('per part')
    expect(state.calls[0]).toEqual({ method: 'POST', path: '/store-api/auth/users/alice/permissions', search: '', body: { domain: 'shop', engine: 'json', access: 'read' } })

    fireEvent.click(chip('alice · shop · json'))
    await waitFor(() => expect(chip('alice · shop · json').textContent).toBe('read+write'))
    expect(chip('alice · shop').textContent).toBe('per part')
    expect(state.calls[1]).toEqual({ method: 'POST', path: '/store-api/auth/users/alice/permissions', search: '', body: { domain: 'shop', engine: 'json', access: 'write' } })

    fireEvent.click(chip('alice · shop · json'))
    await waitFor(() => expect(chip('alice · shop · json').textContent).toBe('—'))
    expect(chip('alice · shop').textContent).toBe('—')
    expect(state.calls[2]).toEqual({ method: 'DELETE', path: '/store-api/auth/users/alice/permissions/shop', search: '?engine=json' })
    expect(state.calls).toHaveLength(3)
  })

  it("a click on an inherited part chip continues from the inherited level with the chip's engine", async () => {
    const { state, handlers } = permissionServer('alice', [{ domain: 'shop', access: 'read' }])
    server.use(versionHandler(), ...domainHandlers(), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    expect(chip('alice · shop · kv').textContent).toBe('read')
    expect(chip('alice · shop · kv')).toHaveClass('admin-users__cell--inherited')

    fireEvent.click(chip('alice · shop · kv'))
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('per part'))
    expect(state.calls).toEqual([{ method: 'POST', path: '/store-api/auth/users/alice/permissions', search: '', body: { domain: 'shop', engine: 'kv', access: 'write' } }])
    expect(state.permissions).toEqual(
      expect.arrayContaining([
        { domain: 'shop', engine: 'kv', access: 'write' },
        { domain: 'shop', engine: 'json', access: 'read' },
        { domain: 'shop', engine: 'rel', access: 'read' },
      ]),
    )
    expect(state.permissions).toHaveLength(3)
    expect(chip('alice · shop · kv').textContent).toBe('read+write')
    expect(chip('alice · shop · kv')).not.toHaveClass('admin-users__cell--inherited')
    for (const engine of ['json', 'rel']) {
      expect(chip(`alice · shop · ${engine}`).textContent).toBe('read')
      expect(chip(`alice · shop · ${engine}`)).not.toHaveClass('admin-users__cell--inherited')
    }
  })

  it('never sends allow_missing with a permission POST', async () => {
    const { state, handlers } = permissionServer('alice', [])
    server.use(versionHandler(), ...domainHandlers(), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    fireEvent.click(chip('alice · shop'))
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('read'))
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]?.method).toBe('POST')
    expect(state.calls[0]?.search).toBe('')
  })

  it('shows ddl and an unknown level verbatim and revokes each with one DELETE instead of cycling', async () => {
    const { state, handlers } = permissionServer('alice', [
      { domain: 'shop', engine: 'kv', access: 'ddl' },
      { domain: 'logs', access: 'super' },
    ])
    server.use(versionHandler(), domainsHandler('shop', 'logs'), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    expect(chip('alice · shop · kv').textContent).toBe('ddl')
    expect(chip('alice · logs').textContent).toBe('super')

    fireEvent.click(chip('alice · shop · kv'))
    await waitFor(() => expect(chip('alice · shop · kv').textContent).toBe('—'))
    expect(state.calls).toEqual([{ method: 'DELETE', path: '/store-api/auth/users/alice/permissions/shop', search: '?engine=kv' }])

    fireEvent.click(chip('alice · logs'))
    await waitFor(() => expect(chip('alice · logs').textContent).toBe('—'))
    expect(state.calls).toHaveLength(2)
    expect(state.calls[1]).toEqual({ method: 'DELETE', path: '/store-api/auth/users/alice/permissions/logs', search: '' })
  })

  it('shows the server text of a 404 at the chip, keeps the chip value and reloads the user list and the domain list', async () => {
    const gets = { users: 0, domains: 0 }
    server.use(
      versionHandler(),
      http.get(`${ORIGIN}/store-api/domains`, () => {
        gets.domains += 1
        return HttpResponse.json([domainResponse('shop')])
      }),
      http.get(`${ORIGIN}/store-api/auth/users`, () => {
        gets.users += 1
        return HttpResponse.json([{ name: 'alice', role: 'User', created_at: 1, permissions: [] }])
      }),
      http.post(`${ORIGIN}/store-api/auth/users/alice/permissions`, () => plaintext(404, '404 Not Found: domain not found')),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    const before = { ...gets }
    fireEvent.click(chip('alice · shop'))

    const row = screen.getByText('alice').closest('.admin-users__item') as HTMLElement
    await waitFor(() => expect(row.querySelector('.admin-users__cell-error')?.textContent).toBe('404 Not Found: domain not found'))
    expect(chip('alice · shop').textContent).toBe('—')
    await waitFor(() => expect(gets).toEqual({ users: before.users + 1, domains: before.domains + 1 }))
  })

  it('shows the server text of a 400 unchanged at the chip', async () => {
    const { handlers } = permissionServer('alice', [])
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.post(`${ORIGIN}/store-api/auth/users/alice/permissions`, () => plaintext(400, "access must be 'read', 'write' or 'ddl'")),
      ...handlers,
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    fireEvent.click(chip('alice · shop'))

    const row = screen.getByText('alice').closest('.admin-users__item') as HTMLElement
    await waitFor(() => expect(row.querySelector('.admin-users__cell-error')?.textContent).toBe("access must be 'read', 'write' or 'ddl'"))
  })

  it('shows a fallback with the status at the chip when the error body is empty', async () => {
    const { handlers } = permissionServer('alice', [])
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.post(`${ORIGIN}/store-api/auth/users/alice/permissions`, () => new HttpResponse(null, { status: 500 })),
      ...handlers,
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    await screen.findByText('alice')
    fireEvent.click(chip('alice · shop'))

    const row = screen.getByText('alice').closest('.admin-users__item') as HTMLElement
    await waitFor(() => expect(row.querySelector('.admin-users__cell-error')?.textContent).toBe('permission update failed (HTTP 500)'))
    expect(chip('alice · shop').textContent).toBe('—')
  })

  it('lists a grant on a domain outside the domain list under the user row and revokes it with one DELETE', async () => {
    const { state, handlers } = permissionServer('alice', [
      { domain: 'ghost', access: 'read' },
      { domain: 'ghost2', engine: 'kv', access: 'write' },
    ])
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () =>
        HttpResponse.json([
          { name: 'alice', role: 'User', created_at: 1, permissions: state.permissions },
          { name: 'bob', role: 'User', created_at: 2, permissions: [] },
        ]),
      ),
      ...handlers,
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const aliceItem = (await screen.findByText('alice')).closest('.admin-users__item') as HTMLElement
    const offgrid = aliceItem.querySelector('.admin-users__offgrid') as HTMLElement
    expect(offgrid).not.toBeNull()
    expect(offgrid).toHaveAttribute('title', 'the domain is not in the domain list — granted ahead of its creation')
    expect(within(offgrid).getByText('granted outside the domain list:')).toBeInTheDocument()
    expect(within(offgrid).getByText('ghost · whole domain · read')).toBeInTheDocument()
    expect(within(offgrid).getByText('ghost2 · kv · write')).toBeInTheDocument()

    const bobItem = screen.getByText('bob').closest('.admin-users__item') as HTMLElement
    expect(bobItem.querySelector('.admin-users__offgrid')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'revoke ghost · whole domain for alice' }))
    await waitFor(() => expect(screen.queryByText('ghost · whole domain · read')).not.toBeInTheDocument())
    expect(state.calls).toEqual([{ method: 'DELETE', path: '/store-api/auth/users/alice/permissions/ghost', search: '' }])

    fireEvent.click(screen.getByRole('button', { name: 'revoke ghost2 · kv for alice' }))
    await waitFor(() => expect(aliceItem.querySelector('.admin-users__offgrid')).not.toBeInTheDocument())
    expect(state.calls).toHaveLength(2)
    expect(state.calls[1]).toEqual({ method: 'DELETE', path: '/store-api/auth/users/alice/permissions/ghost2', search: '?engine=kv' })
  })

  it('shows no off-grid row for a regular user until the domain list has loaded', async () => {
    const { handlers } = permissionServer('alice', [{ domain: 'shop', access: 'read' }])
    let release = (): void => undefined
    const hold = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    server.use(
      versionHandler(),
      http.get(`${ORIGIN}/store-api/domains`, async () => {
        await hold
        return HttpResponse.json([domainResponse('shop')])
      }),
      ...handlers,
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const item = (await screen.findByText('alice')).closest('.admin-users__item') as HTMLElement
    expect(item.querySelector('.admin-users__offgrid')).not.toBeInTheDocument()

    release()
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('read'))
    expect(item.querySelector('.admin-users__offgrid')).not.toBeInTheDocument()
  })

  it('renders every permissions entry exactly once: chip values plus off-grid entries', async () => {
    const { handlers } = permissionServer('alice', [
      { domain: 'shop', engine: 'kv', access: 'write' },
      { domain: 'shop', engine: 'json', access: 'read' },
      { domain: 'ghost', engine: 'rel', access: 'ddl' },
    ])
    server.use(versionHandler(), ...domainHandlers(), ...handlers)
    await act(() => connect(makeConnection()))
    renderConnected()

    const item = (await screen.findByText('alice')).closest('.admin-users__item') as HTMLElement
    const ownChips = [...item.querySelectorAll('.admin-users__cell:not(.admin-users__cell--none):not(.admin-users__cell--inherited)')].filter(
      (cell) => cell.textContent !== 'per part',
    )
    const offgridItems = item.querySelectorAll('.admin-users__offgrid-item')
    expect(ownChips.map((cell) => cell.getAttribute('aria-label'))).toEqual(['alice · shop · kv', 'alice · shop · json'])
    expect(offgridItems).toHaveLength(1)
    expect(within(item).getByText('ghost · rel · ddl')).toBeInTheDocument()
    expect(ownChips.length + offgridItems.length).toBe(3)
  })

  it('lists the stored permissions of an admin under the admin row with their own label', async () => {
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () =>
        HttpResponse.json([{ name: 'root', role: 'Admin', created_at: 1, permissions: [{ domain: 'shop', access: 'write' }] }]),
      ),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const item = (await screen.findByText('root')).closest('.admin-users__item') as HTMLElement
    expect(item.querySelector('.admin-users__cell--all')?.textContent).toBe('all')
    const offgrid = item.querySelector('.admin-users__offgrid') as HTMLElement
    expect(offgrid).not.toBeNull()
    expect(offgrid).not.toHaveAttribute('title')
    expect(within(offgrid).getByText('stored grants (no effect for an admin):')).toBeInTheDocument()
    expect(within(offgrid).queryByText('granted outside the domain list:')).not.toBeInTheDocument()
    expect(within(offgrid).getByText('shop · whole domain · write')).toBeInTheDocument()
    expect(within(offgrid).getByRole('button', { name: 'revoke shop · whole domain for root' })).toBeInTheDocument()
  })

  it('shows the server text when an off-grid revoke fails', async () => {
    let userGets = 0
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => {
        userGets += 1
        return HttpResponse.json([{ name: 'alice', role: 'User', created_at: 1, permissions: [{ domain: 'ghost', access: 'read' }] }])
      }),
      http.delete(`${ORIGIN}/store-api/auth/users/alice/permissions/ghost`, () => plaintext(404, '404 Not Found: permission not found')),
    )
    await act(() => connect(makeConnection()))
    renderConnected()

    const item = (await screen.findByText('alice')).closest('.admin-users__item') as HTMLElement
    const before = userGets
    fireEvent.click(screen.getByRole('button', { name: 'revoke ghost · whole domain for alice' }))

    await waitFor(() =>
      expect(item.querySelector('.admin-users__offgrid .admin-users__error')?.textContent).toBe('404 Not Found: permission not found'),
    )
    await waitFor(() => expect(userGets).toBe(before + 1))
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

  it('shows the server state again after a remount', async () => {
    const { handlers } = permissionServer('alice', [])
    server.use(versionHandler(), ...domainHandlers(), ...handlers)
    await act(() => connect(makeConnection()))
    const { unmount } = renderConnected()

    await screen.findByText('alice')
    fireEvent.click(chip('alice · shop'))
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('read'))

    unmount()
    renderConnected()

    await screen.findByText('alice')
    await waitFor(() => expect(chip('alice · shop').textContent).toBe('read'))
  })

  it('shows a red inline error on a 500 while the previously loaded matrix stays visible (spec admin/005 §2)', async () => {
    let call = 0
    server.use(
      versionHandler(),
      ...domainHandlers(),
      http.get(`${ORIGIN}/store-api/auth/users`, () => {
        call += 1
        if (call === 1) return HttpResponse.json([{ name: 'shop-svc', role: 'User', created_at: 1 }])
        return new HttpResponse(null, { status: 500 })
      }),
    )
    await act(() => connect(makeConnection()))
    const queryClient = createAppQueryClient()
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ConnectedUsersCard />
      </QueryClientProvider>,
    )
    await screen.findByText('shop-svc')
    unmount()

    render(
      <QueryClientProvider client={queryClient}>
        <ConnectedUsersCard />
      </QueryClientProvider>,
    )

    expect(screen.getByText('shop-svc')).toBeInTheDocument()
    expect(await screen.findByText('users unavailable — 500 user list failed')).toBeInTheDocument()
  })
})
