import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { applyPending, type PendingChange } from './configModel'
import { ConfigScreen } from './ConfigScreen'
import { REFERENCE_TOML } from './referenceToml'

function renderLoaded() {
  localStorage.setItem('luradb.toml', REFERENCE_TOML)
  return render(<ConfigScreen />)
}

function rowOf(label: string): HTMLElement {
  const key = screen.getByText(label)
  const row = key.closest('.config-row')
  if (row === null) throw new Error(`no row for ${label}`)
  return row as HTMLElement
}

describe('ConfigScreen', () => {
  it('shows the empty-state notice and the load actions when nothing is loaded', () => {
    render(<ConfigScreen />)

    expect(screen.getByText(/no toml loaded/)).toBeInTheDocument()
    expect(screen.getByText('open file…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'paste…' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('filter keys…')).not.toBeInTheDocument()
  })

  it('loads a pasted toml, persists it, and renders the section cards', () => {
    render(<ConfigScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'paste…' }))
    fireEvent.change(screen.getByPlaceholderText('paste luradb.toml contents…'), { target: { value: REFERENCE_TOML } })
    fireEvent.click(screen.getByRole('button', { name: 'load pasted toml' }))

    expect(screen.getByText('[server]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3000' })).toBeInTheDocument()
    expect(localStorage.getItem('luradb.toml')).toBe(REFERENCE_TOML)
  })

  it('masks the changeme api_key with •••••• and ⚠, never rendering the raw secret', () => {
    renderLoaded()

    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(screen.getByText('⚠')).toBeInTheDocument()
    expect(screen.queryByText(/changeme/)).not.toBeInTheDocument()
  })

  it('edits a number value into a pending change with a "was" note', () => {
    renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '3000' }))
    const input = screen.getByDisplayValue('3000')
    fireEvent.change(input, { target: { value: '3001' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('1 pending change')).toBeInTheDocument()
    expect(screen.getByText('server.port 3000→3001')).toBeInTheDocument()
    expect(screen.getByText('was 3000')).toBeInTheDocument()
  })

  it('picks a log.level enum via the segmented control', () => {
    renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'info' }))

    expect(screen.getByText('log.level verbose→info')).toBeInTheDocument()
  })

  it('toggles a boolean value', () => {
    renderLoaded()
    fireEvent.click(within(rowOf('swagger_enabled')).getByRole('button', { name: 'true' }))

    expect(screen.getByText('server.swagger_enabled true→false')).toBeInTheDocument()
  })

  it('reverts all pending changes', () => {
    renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'info' }))
    expect(screen.getByText('1 pending change')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'revert' }))

    expect(screen.queryByText('1 pending change')).not.toBeInTheDocument()
    expect(screen.queryByText('log.level verbose→info')).not.toBeInTheDocument()
  })

  it('filters rows by key substring', () => {
    renderLoaded()
    fireEvent.change(screen.getByPlaceholderText('filter keys…'), { target: { value: 'port' } })

    expect(screen.getByText('port')).toBeInTheDocument()
    expect(screen.queryByText('bind_address')).not.toBeInTheDocument()
  })

  it('downloads the patched toml (content == applyPending over the pending diff)', async () => {
    const blobs: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      value: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:mock'
      },
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '3000' }))
    const input = screen.getByDisplayValue('3000')
    fireEvent.change(input, { target: { value: '3001' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'download updated toml ↓' }))

    const expected = applyPending(REFERENCE_TOML, new Map<string, PendingChange>([['server.port', { old: 3000, new: 3001 }]]))
    const downloaded = blobs[0]
    expect(downloaded).toBeDefined()
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(downloaded!)
    })
    expect(content).toBe(expected)
    expect(expected).toContain('port = 3001            # HTTP listen port')

    vi.restoreAllMocks()
  })
})
