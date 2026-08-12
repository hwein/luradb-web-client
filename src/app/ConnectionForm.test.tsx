import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from './connections'
import { ConnectionForm, normalizeServerUrl } from './ConnectionForm'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'local',
    type: { kind: 'rest', url: 'https://127.0.0.1:3443' },
    auth: { kind: 'api-key', key: undefined },
    ...overrides,
  }
}

describe('normalizeServerUrl', () => {
  it('repariert einen fehlenden Slash nach dem Schema (http:/host)', () => {
    expect(normalizeServerUrl('http:/localhost:3000/')).toBe('http://localhost:3000')
  })

  it('entfernt trailing Slashes', () => {
    expect(normalizeServerUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000')
  })

  it('lässt eine saubere URL unverändert', () => {
    expect(normalizeServerUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
  })

  it('trimmt Whitespace', () => {
    expect(normalizeServerUrl('  http://127.0.0.1:3000  ')).toBe('http://127.0.0.1:3000')
  })

  it('lässt Unparsbares roh durch (Connect meldet dann unreachable)', () => {
    expect(normalizeServerUrl('not a url')).toBe('not a url')
  })
})

describe('ConnectionForm — accept self-signed certificates checkbox', () => {
  it('appears with its warning hint in create mode (desktop)', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    render(<ConnectionForm target={{ mode: 'create' }} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByLabelText('Accept self-signed certificates')).toBeInTheDocument()
    expect(screen.getByText(/TLS certificate verification/)).toBeInTheDocument()
  })

  it('appears in edit mode (desktop), pre-checked when the connection already has the flag set', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const connection = makeConnection({ type: { kind: 'rest', url: 'https://127.0.0.1:3443', acceptInvalidCerts: true } })
    render(<ConnectionForm target={{ mode: 'edit', connection }} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByLabelText('Accept self-signed certificates')).toBeChecked()
  })

  it('does not appear in connect mode, even on desktop', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    render(<ConnectionForm target={{ mode: 'connect', connection: makeConnection() }} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.queryByLabelText('Accept self-signed certificates')).not.toBeInTheDocument()
  })

  it('is written into the submitted connection when checked (desktop create)', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const onSubmit = vi.fn()
    render(<ConnectionForm target={{ mode: 'create' }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'local' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://127.0.0.1:3443' } })
    fireEvent.click(screen.getByLabelText('Accept self-signed certificates'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [connection] = onSubmit.mock.calls[0] as [Connection, boolean]
    expect(connection.type).toMatchObject({ acceptInvalidCerts: true })
  })

  it('survives a browser-mode edit unchanged (no stub — the checkbox is not rendered, but the flag must not be dropped)', () => {
    const onSubmit = vi.fn()
    const connection = makeConnection({ type: { kind: 'rest', url: 'https://127.0.0.1:3443', acceptInvalidCerts: true } })
    render(<ConnectionForm target={{ mode: 'edit', connection }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    expect(screen.queryByLabelText('Accept self-signed certificates')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [submitted] = onSubmit.mock.calls[0] as [Connection, boolean]
    expect(submitted.type.acceptInvalidCerts).toBe(true)
  })
})
