import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZoomToast } from './ZoomToast'

describe('ZoomToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('renders the factor as Zoom 125 %', () => {
    const { container, rerender } = render(<ZoomToast command={null} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<ZoomToast command={{ factor: 1.25, step: 1 }} />)
    expect(screen.getByText('Zoom 125 %')).toBeInTheDocument()
  })

  it('disappears 1200 ms after the last zoom step', () => {
    render(<ZoomToast command={{ factor: 0.9, step: 1 }} />)
    advance(1199)
    expect(screen.getByText('Zoom 90 %')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByText('Zoom 90 %')).not.toBeInTheDocument()
  })

  it('a further zoom step within 1200 ms restarts the timer and keeps a single toast', () => {
    const { container, rerender } = render(<ZoomToast command={{ factor: 1.75, step: 1 }} />)
    advance(800)
    rerender(<ZoomToast command={{ factor: 2, step: 2 }} />)
    expect(screen.getByText('Zoom 200 %')).toBeInTheDocument()
    expect(screen.queryByText('Zoom 175 %')).not.toBeInTheDocument()
    expect(container.childElementCount).toBe(1)

    // Same factor at the upper limit: still a new command
    advance(800)
    rerender(<ZoomToast command={{ factor: 2, step: 3 }} />)
    advance(800)
    expect(screen.getByText('Zoom 200 %')).toBeInTheDocument()
    expect(container.childElementCount).toBe(1)
    advance(400)
    expect(container).toBeEmptyDOMElement()
  })
})
