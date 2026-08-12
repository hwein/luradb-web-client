import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../test/msw'
import { ConnectionGate } from './ConnectionGate'
import { disconnect } from './session'

const ORIGIN = window.location.origin

afterEach(() => {
  act(() => disconnect())
})

function createConnection(name: string, key?: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  if (key !== undefined) {
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } })
    fireEvent.click(screen.getByLabelText('Remember key'))
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('ConnectionGate', () => {
  it('opens the create form directly on first start (no connections yet)', () => {
    render(<ConnectionGate />)
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('does not auto-open the form once connections already exist', () => {
    localStorage.setItem(
      'luradb.connections',
      JSON.stringify({
        schemaVersion: 1,
        connections: [{ id: 'x', name: 'existing', type: { kind: 'rest', url: 'http://127.0.0.1:3000' }, auth: { kind: 'api-key' } }],
      }),
    )
    render(<ConnectionGate />)

    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.getByText('existing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ new connection' })).toBeInTheDocument()
  })

  it('creates a connection without connecting immediately', () => {
    render(<ConnectionGate />)
    createConnection('local')

    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.queryByText('connecting…')).not.toBeInTheDocument()
  })

  it('asks for confirmation before deleting a connection', () => {
    render(<ConnectionGate />)
    createConnection('local')

    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    expect(screen.getByText('delete this connection?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(screen.getByText('local')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'yes' }))
    expect(screen.queryByText('local')).not.toBeInTheDocument()
  })

  it('connects directly, without a dialog, when a key is already stored', async () => {
    server.use(http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.2.0', server_version: '0.2.0' })))
    render(<ConnectionGate />)
    createConnection('local', 'lura_secret')

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    expect(screen.queryByText('connect to local')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('connecting…')).not.toBeInTheDocument())
  })

  it('opens a connect dialog asking for the key when none is stored', () => {
    render(<ConnectionGate />)
    createConnection('local')

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    expect(screen.getByText('connect to local')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })
})
