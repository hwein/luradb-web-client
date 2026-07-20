import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MetricsSnapshot } from './metrics'
import { SystemThroughput } from './SystemThroughput'

function snapshot(totalReads: number, totalWrites: number): MetricsSnapshot {
  return { system: { totalReads, totalWrites, compactionRuns: 0, janitorRuns: 0, memtableSizeBytes: 0 } }
}

function throughputText(container: HTMLElement): string {
  return container.querySelector('.engines__throughput')?.textContent ?? ''
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Component-Integrationstest der Sample-Historie (spec engines/001 §1/§2, Orchestrator-Hinweis 2):
 * `Date.now` wird auf zwei feste, 5s auseinanderliegende Zeitpunkte gemockt, damit die Delta-Ableitung
 * deterministisch bleibt — die reine Rechenlogik selbst ist bereits in rate.test.ts durchgetestet.
 */
describe('SystemThroughput', () => {
  it('shows zero throughput before a second sample, then the derived rate once metrics update', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_005_000)

    const { rerender, container } = render(<SystemThroughput metrics={snapshot(100, 40)} />)
    expect(throughputText(container)).toContain('0 reads/s')
    expect(throughputText(container)).toContain('0 writes/s')

    rerender(<SystemThroughput metrics={snapshot(600, 240)} />)

    expect(throughputText(container)).toContain('100 reads/s')
    expect(throughputText(container)).toContain('40 writes/s')
  })

  it('ignores a counter reset (server restart) instead of showing a negative rate', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_005_000)

    const { rerender, container } = render(<SystemThroughput metrics={snapshot(500, 200)} />)
    rerender(<SystemThroughput metrics={snapshot(10, 5)} />)

    expect(throughputText(container)).toContain('0 reads/s')
    expect(throughputText(container)).toContain('0 writes/s')
  })

  it('renders the system-wide label and a 12-bar sparkline per stat', () => {
    const { container } = render(<SystemThroughput metrics={snapshot(0, 0)} />)

    expect(throughputText(container)).toContain('system-wide · derived from /store-api/metrics')
    expect(container.querySelectorAll('.engines__spark')).toHaveLength(2)
    expect(container.querySelectorAll('.engines__spark-bar')).toHaveLength(24)
  })

  it('shows a placeholder zero state when no metrics have loaded yet', () => {
    const { container } = render(<SystemThroughput metrics={undefined} />)

    expect(throughputText(container)).toContain('0 reads/s')
    expect(throughputText(container)).toContain('0 writes/s')
  })
})
