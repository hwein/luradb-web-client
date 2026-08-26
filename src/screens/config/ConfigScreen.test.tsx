import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfigScreen } from './ConfigScreen'
import { REFERENCE_TOML } from './referenceToml'

function renderLoaded() {
  render(<ConfigScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'paste…' }))
  fireEvent.change(screen.getByPlaceholderText('paste luradb.toml contents…'), { target: { value: REFERENCE_TOML } })
  fireEvent.click(screen.getByRole('button', { name: 'load pasted toml' }))
}

function rowOf(label: string): HTMLElement {
  const key = screen.getByText(label)
  const row = key.closest('.config-row')
  if (row === null) throw new Error(`no row for ${label}`)
  return row as HTMLElement
}

describe('ConfigScreen', () => {
  it('shows the empty-state notice (no edit promise) and the load actions when nothing is loaded', () => {
    render(<ConfigScreen />)

    expect(screen.getByText(/no toml loaded.*load yours to view it/)).toBeInTheDocument()
    expect(screen.getByText('open file…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'paste…' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('filter keys…')).not.toBeInTheDocument()
  })

  it('loads a pasted toml and renders the section cards, without persisting it to localStorage', () => {
    renderLoaded()

    expect(screen.getByText('[server]')).toBeInTheDocument()
    expect(screen.getByText('3000')).toBeInTheDocument()
    expect(localStorage.getItem('luradb.toml')).toBeNull()
  })

  it('masks the changeme api_key with •••••• and ⚠, never rendering the raw secret', () => {
    renderLoaded()

    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(screen.getByText('⚠')).toBeInTheDocument()
    expect(screen.queryByText(/changeme/)).not.toBeInTheDocument()
  })

  it('renders a boolean value as plain green text, not a button', () => {
    renderLoaded()

    const value = within(rowOf('swagger_enabled')).getByText('true')
    expect(value.tagName).toBe('SPAN')
    expect(value.className).toContain('config-row__value--bool')
    expect(within(rowOf('swagger_enabled')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('filters rows by key substring', () => {
    renderLoaded()
    fireEvent.change(screen.getByPlaceholderText('filter keys…'), { target: { value: 'port' } })

    expect(screen.getByText('port')).toBeInTheDocument()
    expect(screen.queryByText('bind_address')).not.toBeInTheDocument()
  })

  it('does not open an input when a value is clicked (no edit entry point)', () => {
    renderLoaded()
    const textboxesBefore = screen.getAllByRole('textbox').length

    fireEvent.click(screen.getByText('3000'))

    expect(screen.getAllByRole('textbox').length).toBe(textboxesBefore)
    expect(screen.queryByDisplayValue('3000')).not.toBeInTheDocument()
  })

  it('never renders the removed pending-bar or download actions', () => {
    renderLoaded()

    expect(screen.queryByRole('button', { name: 'download toml ↓' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'download updated toml ↓' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'revert' })).not.toBeInTheDocument()
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()
  })
})
