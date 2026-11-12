import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerChangelog } from '../api'
import type { Connection } from '../app/connections'
import { createAppQueryClient } from '../app/queryClient'
import { connect, disconnect } from '../app/session'
import { server } from '../test/msw'
import { Statusbar } from './Statusbar'

const CHANGELOG: ServerChangelog = {
  releases: [{ version: '0.7.1', date: '2026-11-09', sections: [{ key: 'added', entries: [{ text: 'a change', api: false, breaking: false }] }] }],
}

const changelogMock = vi.hoisted(() => ({ value: null as ServerChangelog | null }))

// The barrel re-exports from this module; the getter lets each test switch between a changelog and `null`.
vi.mock('../api/serverChangelog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/serverChangelog')>()
  return {
    ...actual,
    get serverChangelog() {
      return changelogMock.value
    },
  }
})

const ORIGIN = window.location.origin

function makeConnection(): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: '' },
    auth: { kind: 'api-key', key: 'lura_secret' },
  }
}

async function renderConnectedStatusbar(changelog: ServerChangelog | null): Promise<void> {
  changelogMock.value = changelog
  server.use(
    http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
    http.get(`${ORIGIN}/store-api/auth/whoami`, () => HttpResponse.json({ name: 'admin', role: 'Admin' })),
    http.get(`${ORIGIN}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 4260 })),
  )
  await act(() => connect(makeConnection()))

  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <Statusbar />
    </QueryClientProvider>,
  )
  await screen.findByText('luradb 0.7.1')
}

afterEach(() => {
  disconnect()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

describe('Statusbar', () => {
  it('renders the server label as a what\'s-new button when a changelog is bundled', async () => {
    await renderConnectedStatusbar(CHANGELOG)

    expect(screen.getByTitle("what's new in luradb").tagName).toBe('BUTTON')
  })

  it('mounts no dialog before the server label is clicked', async () => {
    await renderConnectedStatusbar(CHANGELOG)

    expect(document.querySelector('dialog')).not.toBeInTheDocument()
  })

  it('mounts the what\'s-new dialog on server label click', async () => {
    // jsdom has no showModal() (only `open` is reflected) — stubbed because this test triggers the opening click.
    HTMLDialogElement.prototype.showModal = function showModalStub(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    await renderConnectedStatusbar(CHANGELOG)

    fireEvent.click(screen.getByTitle("what's new in luradb"))

    expect(document.querySelector('dialog.whats-new')).toBeInTheDocument()
  })

  it('keeps the server label a plain span when no changelog is bundled', async () => {
    await renderConnectedStatusbar(null)

    expect(screen.queryByTitle("what's new in luradb")).not.toBeInTheDocument()
    expect(document.querySelector('.statusbar__server')?.tagName).toBe('SPAN')
  })
})
