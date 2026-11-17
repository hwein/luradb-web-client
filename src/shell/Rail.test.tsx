import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../app/queryClient'
import { Rail } from './Rail'

vi.mock('../app/queryClient', () => ({ endSession: vi.fn() }))

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

function renderRail() {
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Rail />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('Rail', () => {
  it('renders the logo as an about-dialog entry point', () => {
    renderRail()

    expect(screen.getByTitle('about LuraDB Client').tagName).toBe('BUTTON')
  })

  it('mounts the about dialog on logo click', () => {
    // jsdom kennt showModal() nicht (nur `open` wird reflektiert) — hier gestubbt, weil dieser Test den
    // öffnenden Klick tatsächlich auslöst (anders als z. B. Explorer.test.tsx, das ihn meidet).
    HTMLDialogElement.prototype.showModal = function showModalStub(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    renderRail()

    fireEvent.click(screen.getByTitle('about LuraDB Client'))

    expect(document.querySelector('dialog')).toBeInTheDocument()
  })

  it('ends the session from the disconnect button below the theme toggle', () => {
    const queryClient = renderRail()

    const theme = screen.getByTitle('Toggle theme')
    const disconnect = screen.getByTitle('Disconnect')
    expect(theme.compareDocumentPosition(disconnect)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    fireEvent.click(disconnect)

    expect(endSession).toHaveBeenCalledWith(queryClient)
  })
})
