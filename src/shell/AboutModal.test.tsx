import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AboutContent } from './AboutModal'

describe('AboutContent', () => {
  it('shows the app name and the version from __APP_VERSION__', () => {
    render(<AboutContent onClose={() => {}} />)

    expect(screen.getByText('LuraDB Client')).toBeInTheDocument()
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('shows the FSL license line and the copyright notice', () => {
    render(<AboutContent onClose={() => {}} />)

    expect(screen.getByText(/Functional Source License 1\.1, Apache-2\.0 future license/)).toBeInTheDocument()
    expect(screen.getByText('(FSL-1.1-ALv2)')).toBeInTheDocument()
    expect(screen.getByText('© 2026 Heiko Wein')).toBeInTheDocument()
  })

  it('lists frontend dependency names from __APP_DEPENDENCIES__ and the static rust dependency names', () => {
    render(<AboutContent onClose={() => {}} />)

    const frontendList = screen.getByRole('list', { name: 'frontend' })
    __APP_DEPENDENCIES__.forEach((name) => {
      expect(within(frontendList).getByText(name)).toBeInTheDocument()
    })

    const rustList = screen.getByRole('list', { name: 'desktop shell (rust)' })
    ;['serde', 'serde_json', 'tauri', 'tauri-plugin-http'].forEach((name) => {
      expect(within(rustList).getByText(name)).toBeInTheDocument()
    })
  })

  it('never shows a version pattern in either library list (hardening invariant spec shell/005 §1)', () => {
    render(<AboutContent onClose={() => {}} />)

    const entries = [
      ...within(screen.getByRole('list', { name: 'frontend' })).getAllByRole('listitem'),
      ...within(screen.getByRole('list', { name: 'desktop shell (rust)' })).getAllByRole('listitem'),
    ]
    expect(entries.length).toBeGreaterThan(0)
    entries.forEach((entry) => expect(entry.textContent ?? '').not.toMatch(/\d+\.\d+/))
  })

  it('calls onClose from the close button', () => {
    const onClose = vi.fn()
    render(<AboutContent onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
