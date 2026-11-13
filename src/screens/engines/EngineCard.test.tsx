import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EngineCard } from './EngineCard'
import type { EngineMetrics } from './metrics'

const METRICS: EngineMetrics = {
  readOps: 100,
  writeOps: 200,
  readLatencyUsP50: 5,
  readLatencyUsP95: 50,
  writeLatencyUsP50: 500,
  writeLatencyUsP95: 5000,
  windowSecs: 60,
}

function renderCard(metrics: EngineMetrics | undefined) {
  return render(
    <EngineCard tone="kv" title="KV ENGINE" online rows={[]} domains={[]} onOpenDomain={() => undefined} metrics={metrics} spark={[]} />,
  )
}

function text(container: HTMLElement, selector: string): string {
  return container.querySelector(selector)?.textContent ?? ''
}

function latencyLines(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.engines__card-lat')).map((line) => line.textContent ?? '')
}

describe('EngineCard metrics', () => {
  it('shows the ops/s number and the window note', () => {
    const { container } = renderCard(METRICS)

    expect(text(container, '.engines__card-ops')).toContain('5.0')
    expect(text(container, '.engines__card-ops')).toContain(' ops/s')
    expect(text(container, '.engines__card-window')).toContain('60s window')
  })

  it('shows read and write latency lines in µs and ms', () => {
    const { container } = renderCard(METRICS)

    expect(latencyLines(container)).toEqual(['reads 1.7/s · p50 5 µs · p95 50 µs', 'writes 3.3/s · p50 500 µs · p95 5.0 ms'])
  })

  it('omits the percentiles of a line whose counter is 0', () => {
    const { container } = renderCard({ ...METRICS, readOps: 0 })

    expect(latencyLines(container)[0]).toBe('reads 0/s')
    expect(latencyLines(container)[1]).toContain('p50')
  })

  it('marks a window with a single read', () => {
    const { container } = renderCard({ ...METRICS, readOps: 1, writeOps: 0 })

    expect(text(container, '.engines__card-ops')).toBe('<0.1 ops/s')
    expect(latencyLines(container)).toEqual(['reads <0.1/s · p50 5 µs · p95 50 µs', 'writes 0/s'])
  })

  it('shows the placeholder and no latency lines without metrics', () => {
    const { container } = renderCard(undefined)

    expect(text(container, '.engines__card-ops')).toContain('…')
    expect(text(container, '.engines__card-ops')).toContain(' ops/s')
    expect(container.querySelector('.engines__card-lat')).not.toBeInTheDocument()
    expect(container.querySelector('.engines__card-window')).not.toBeInTheDocument()
  })

  it('renders a 12-bar sparkline', () => {
    const { container } = renderCard(METRICS)

    expect(container.querySelectorAll('.engines__spark-bar')).toHaveLength(12)
  })
})
