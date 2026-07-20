import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { Rail } from './Rail'

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

function renderRail() {
  return render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  )
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
})
