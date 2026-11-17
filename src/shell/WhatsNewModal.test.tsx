import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ServerChangelog } from '../api'
import { WhatsNewContent } from './WhatsNewModal'

const changelog: ServerChangelog = {
  releases: [
    {
      version: '0.7.1',
      date: '2026-11-09',
      sections: [
        {
          key: 'added',
          entries: [
            { text: 'plain entry', api: false, breaking: false },
            { text: 'new route', api: true, breaking: false },
          ],
        },
        { key: 'fixed', entries: [{ text: 'use `GET /x` or ` alone', api: false, breaking: true }] },
      ],
    },
    {
      version: '0.7.0',
      date: '2026-11-08',
      sections: [{ key: 'changed', entries: [{ text: 'older change', api: false, breaking: false }] }],
    },
  ],
}

function renderContent(serverVersion = '0.7.1', onClose = () => {}) {
  return render(<WhatsNewContent changelog={changelog} serverVersion={serverVersion} onClose={onClose} />)
}

describe('WhatsNewContent', () => {
  it('shows the newest release version and date in the header', () => {
    renderContent()

    expect(screen.getByText('up to v0.7.1 · 2026-11-09')).toBeInTheDocument()
    expect(screen.getByText("what's new in luradb")).toBeInTheDocument()
  })

  it('renders one block per release, newest first, each with version and date', () => {
    const { container } = renderContent()

    const heads = [...container.querySelectorAll('.whats-new__release-head')].map((el) => el.textContent)
    expect(heads).toEqual(['v0.7.1 · 2026-11-09', 'v0.7.0 · 2026-11-08'])
  })

  it('renders the non-empty section labels of a release in the order the changelog gives them', () => {
    const { container } = renderContent()

    const first = container.querySelector('.whats-new__release')
    const labels = [...(first?.querySelectorAll('.whats-new__label') ?? [])].map((el) => el.textContent)
    expect(labels).toEqual(['added', 'fixed'])
  })

  it('shows the breaking and api badges only on flagged entries', () => {
    const { container } = renderContent()

    const entries = [...container.querySelectorAll('.whats-new__entry')]
    const badgesOf = (text: string) =>
      [...(entries.find((el) => el.textContent?.includes(text))?.querySelectorAll('.whats-new__badge') ?? [])].map(
        (el) => el.textContent,
      )
    expect(badgesOf('plain entry')).toEqual([])
    expect(badgesOf('new route')).toEqual(['api'])
    expect(badgesOf('GET /x')).toEqual(['breaking'])
    expect(container.querySelectorAll('.whats-new__badge')).toHaveLength(2)
  })

  it('renders a backtick pair as inline code and keeps an unpaired backtick literal', () => {
    const { container } = renderContent()

    const code = container.querySelectorAll('code')
    expect(code).toHaveLength(1)
    expect(code[0]?.textContent).toBe('GET /x')
    const entry = code[0]?.parentElement
    expect(entry?.textContent).toBe('breakinguse GET /x or ` alone')
  })

  it('renders a double-asterisk pair as bold text', () => {
    const entry: ServerChangelog = {
      releases: [
        {
          version: '0.7.1',
          date: '2026-11-09',
          sections: [
            {
              key: 'changed',
              entries: [
                { text: '`PATCH` sets null. **Breaking** status-code Change.', api: false, breaking: false },
                { text: 'lone ** stays', api: false, breaking: false },
                { text: 'in `a **b** c` code', api: false, breaking: false },
              ],
            },
          ],
        },
      ],
    }
    const { container } = render(<WhatsNewContent changelog={entry} serverVersion="0.7.1" onClose={() => {}} />)

    const [bold, lone, inCode] = [...container.querySelectorAll('.whats-new__entry')]
    expect(bold?.querySelectorAll('strong')).toHaveLength(1)
    expect(bold?.querySelector('strong')?.textContent).toBe('Breaking')
    expect(bold?.textContent).not.toContain('*')
    expect(bold?.querySelector('code')?.textContent).toBe('PATCH')
    expect(lone?.textContent).toBe('lone ** stays')
    expect(lone?.querySelector('strong')).toBeNull()
    expect(inCode?.querySelector('strong')).toBeNull()
    expect(inCode?.querySelector('code')?.textContent).toBe('a **b** c')
  })

  it('shows the newer-server line when the server is ahead of the newest listed release', () => {
    renderContent('0.7.2-dev')

    expect(screen.getByText('your server runs 0.7.2-dev — this lists changes up to 0.7.1')).toBeInTheDocument()
  })

  it('shows the older-server line when the server is behind the newest listed release', () => {
    renderContent('0.7.0')

    expect(
      screen.getByText('your server runs 0.7.0 — the newest changes listed here are not in it yet'),
    ).toBeInTheDocument()
  })

  it('shows no comparison line when the versions match', () => {
    const first = renderContent('0.7.1')
    expect(screen.queryByText(/your server runs/)).not.toBeInTheDocument()
    first.unmount()

    renderContent('0.7.1-dev')
    expect(screen.queryByText(/your server runs/)).not.toBeInTheDocument()
  })

  it('renders no links and no github reference', () => {
    const { container } = renderContent()

    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('http')
    expect(container.innerHTML).not.toContain('github')
  })

  it('calls onClose from the close button', () => {
    const onClose = vi.fn()
    renderContent('0.7.1', onClose)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
