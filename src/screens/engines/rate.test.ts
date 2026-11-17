import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EngineMetrics, MetricsSnapshot } from './metrics'
import { appendSample, useEngineOpsHistory } from './rate'

describe('appendSample', () => {
  it('appends to an empty history', () => {
    expect(appendSample([], 1)).toEqual([1])
  })

  it('keeps history order, newest last', () => {
    expect(appendSample(appendSample([], 1), 2)).toEqual([1, 2])
  })

  it('caps the history at 12 values, dropping the oldest', () => {
    let history: number[] = []
    for (let i = 0; i < 15; i += 1) history = appendSample(history, i)

    expect(history).toHaveLength(12)
    expect(history[0]).toBe(3)
    expect(history[11]).toBe(14)
  })
})

describe('useEngineOpsHistory', () => {
  const kv: EngineMetrics = {
    readOps: 100,
    writeOps: 200,
    readLatencyUsP50: 0,
    readLatencyUsP95: 0,
    writeLatencyUsP50: 0,
    writeLatencyUsP95: 0,
    windowSecs: 60,
  }
  const snapshot: MetricsSnapshot = { system: { compactionRuns: 0, janitorRuns: 0 }, engines: { kv } }

  it('appends a second value when dataUpdatedAt rises while the data object stays the same', () => {
    const { result, rerender } = renderHook(({ metrics, at }) => useEngineOpsHistory(metrics, at), {
      initialProps: { metrics: snapshot as MetricsSnapshot | undefined, at: 1000 },
    })
    expect(result.current.kv).toEqual([5])

    rerender({ metrics: snapshot, at: 2000 })
    expect(result.current.kv).toEqual([5, 5])
  })

  it('appends nothing without metrics and keeps an engine without an entry flat', () => {
    const { result, rerender } = renderHook(({ metrics, at }) => useEngineOpsHistory(metrics, at), {
      initialProps: { metrics: undefined as MetricsSnapshot | undefined, at: 0 },
    })
    expect(result.current).toEqual({ kv: [], json: [], rel: [] })

    rerender({ metrics: snapshot, at: 1000 })
    expect(result.current).toEqual({ kv: [5], json: [], rel: [] })
  })
})
