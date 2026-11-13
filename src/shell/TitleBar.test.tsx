import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from './TitleBar'

const appWindow = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(),
  onResized: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => appWindow,
}))

let resized: () => void
const unlisten = vi.fn()

beforeEach(() => {
  appWindow.minimize.mockReset().mockResolvedValue(undefined)
  appWindow.toggleMaximize.mockReset().mockResolvedValue(undefined)
  appWindow.close.mockReset().mockResolvedValue(undefined)
  appWindow.isMaximized.mockReset().mockResolvedValue(false)
  appWindow.onResized.mockReset().mockImplementation((handler: () => void) => {
    resized = handler
    return Promise.resolve(unlisten)
  })
  unlisten.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderDesktop() {
  vi.stubGlobal('__TAURI_INTERNALS__', {})
  return render(<TitleBar />)
}

describe('TitleBar', () => {
  it('renders nothing in browser mode', () => {
    const { container } = render(<TitleBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the logo, the product name and three window controls in desktop mode', async () => {
    const { container } = renderDesktop()
    expect(container.querySelector('.titlebar svg')).toBeInTheDocument()
    expect(screen.getByText('LuraDB Client')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    await waitFor(() => expect(appWindow.onResized).toHaveBeenCalled())
  })

  it('calls minimize, toggleMaximize and close on the current window', async () => {
    renderDesktop()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(appWindow.minimize).toHaveBeenCalledTimes(1)
    expect(appWindow.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(appWindow.close).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(appWindow.onResized).toHaveBeenCalled())
  })

  it('shows Restore instead of Maximize once the window reports maximized', async () => {
    const { unmount } = renderDesktop()
    await waitFor(() => expect(appWindow.onResized).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument()

    appWindow.isMaximized.mockResolvedValue(true)
    act(() => resized())
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Maximize' })).not.toBeInTheDocument()

    unmount()
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1))
  })

  it('keeps the window controls out of the tab order and out of the drag region', async () => {
    const { container } = renderDesktop()
    expect(container.querySelector('.titlebar')).toHaveAttribute('data-tauri-drag-region', 'deep')
    const controls = screen.getAllByRole('button')
    expect(controls).toHaveLength(3)
    for (const control of controls) {
      expect(control).toHaveAttribute('tabindex', '-1')
      expect(control).not.toHaveAttribute('data-tauri-drag-region')
    }
    await waitFor(() => expect(appWindow.onResized).toHaveBeenCalled())
  })

  it('renders no window controls on macOS', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const { container } = renderDesktop()
    expect(container.querySelector('.titlebar')).toHaveClass('titlebar--macos')
    expect(screen.getByText('LuraDB Client')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
