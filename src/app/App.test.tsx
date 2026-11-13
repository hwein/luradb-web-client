import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test/msw'
import { App } from './App'
import { disconnect } from './session'

const { setZoom } = vi.hoisted(() => ({ setZoom: vi.fn() }))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}))

const ORIGIN = window.location.origin

beforeEach(() => {
  setZoom.mockReset()
  setZoom.mockResolvedValue(undefined)
})

afterEach(() => {
  disconnect()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function storeRememberedConnection(): void {
  localStorage.setItem(
    'luradb.connections',
    JSON.stringify({
      schemaVersion: 1,
      connections: [
        {
          id: 'conn-1',
          name: 'local',
          type: { kind: 'rest', url: '' },
          auth: { kind: 'api-key', key: 'lura_secret' },
          lastUsed: 1,
        },
      ],
    }),
  )
}

describe('App', () => {
  it('starts in the connection gate', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'LuraDB' })).toBeInTheDocument()
    expect(screen.getByText('WEB CLIENT')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('purges the legacy plaintext-toml localStorage entry on app start', () => {
    localStorage.setItem('luradb.toml', '[auth]\napi_key = "lura_secret"\n')

    render(<App />)

    expect(localStorage.getItem('luradb.toml')).toBeNull()
  })

  it('starts in the gate even with a remembered connection (no autoconnect — app start means a new session)', () => {
    storeRememberedConnection()

    render(<App />)

    expect(screen.getByRole('button', { name: 'connect' })).toBeInTheDocument()
    expect(screen.queryByTitle('disconnect')).not.toBeInTheDocument()
  })

  it('connects with one click on a remembered connection, then can disconnect back to the gate', async () => {
    storeRememberedConnection()
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.17.0', server_version: '0.7.1' })),
      http.get(`${ORIGIN}/store-api/auth/whoami`, () => HttpResponse.json({ name: 'admin', role: 'Admin' })),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 4260 })),
    )

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTitle('disconnect')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('disconnect'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'connect' })).toBeInTheDocument())
  })

  it('applies the stored zoom on the connection gate in desktop mode', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    localStorage.setItem('luradb.zoom', '1.25')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'LuraDB' })).toBeInTheDocument()
    expect(setZoom).toHaveBeenCalledTimes(1)
    expect(setZoom).toHaveBeenCalledWith(1.25)
  })

  it('shows the zoom toast after a zoom shortcut on the connection gate in desktop mode', () => {
    vi.useFakeTimers()
    vi.stubGlobal('__TAURI_INTERNALS__', {})

    render(<App />)
    expect(screen.getByRole('heading', { name: 'LuraDB' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '=', ctrlKey: true })
    expect(screen.getByText('Zoom 110 %')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(screen.queryByText('Zoom 110 %')).not.toBeInTheDocument()
  })

  it('blocks the context menu on the connection gate in desktop mode', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})

    render(<App />)

    expect(fireEvent.contextMenu(screen.getByRole('heading', { name: 'LuraDB' }))).toBe(false)
    expect(fireEvent.contextMenu(screen.getByLabelText('Name'))).toBe(true)
  })

  it('shows the title bar above the connection gate in desktop mode', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})

    const { container } = render(<App />)

    const titleBar = container.querySelector('.titlebar')
    const gate = container.querySelector('.connection-gate')
    expect(titleBar).toBeInTheDocument()
    expect(gate).toBeInTheDocument()
    expect(titleBar?.compareDocumentPosition(gate as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows no title bar in browser mode', () => {
    const { container } = render(<App />)

    expect(screen.getByRole('heading', { name: 'LuraDB' })).toBeInTheDocument()
    expect(container.querySelector('.titlebar')).not.toBeInTheDocument()
    expect(screen.queryByText('LuraDB Client')).not.toBeInTheDocument()
  })

  it('renders no zoom toast on mount and none in browser mode', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const desktop = render(<App />)
    expect(screen.queryByText(/^Zoom /)).not.toBeInTheDocument()
    desktop.unmount()
    vi.unstubAllGlobals()
    setZoom.mockClear()

    render(<App />)
    fireEvent.keyDown(window, { key: '=', ctrlKey: true })
    expect(screen.queryByText(/^Zoom /)).not.toBeInTheDocument()
    expect(setZoom).not.toHaveBeenCalled()
  })
})
