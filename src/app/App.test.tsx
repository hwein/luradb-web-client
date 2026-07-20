import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../test/msw'
import { App } from './App'
import { disconnect } from './session'

const ORIGIN = window.location.origin

afterEach(() => {
  disconnect()
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
          type: { kind: 'rest', url: 'http://127.0.0.1:3000' },
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

  it('starts in the gate even with a remembered connection (no autoconnect — app start means a new session)', () => {
    storeRememberedConnection()

    render(<App />)

    expect(screen.getByRole('button', { name: 'connect' })).toBeInTheDocument()
    expect(screen.queryByTitle('disconnect')).not.toBeInTheDocument()
  })

  it('connects with one click on a remembered connection, then can disconnect back to the gate', async () => {
    storeRememberedConnection()
    server.use(
      http.get(`${ORIGIN}/version`, () => HttpResponse.json({ api_version: '0.1.0', server_version: '0.1.0' })),
      http.get(`${ORIGIN}/store-api/auth/users`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/json/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/store-api/rel/domains`, () => HttpResponse.json([])),
      http.get(`${ORIGIN}/health`, () => HttpResponse.json({ status: 'ok', uptime_secs: 4260 })),
    )

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTitle('disconnect')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('disconnect'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'connect' })).toBeInTheDocument())
  })
})
