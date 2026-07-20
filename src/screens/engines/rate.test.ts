import { describe, expect, it } from 'vitest'
import { appendSample, sampleRate, type RateSample } from './rate'

describe('sampleRate', () => {
  it('derives reads/s and writes/s from two metric states', () => {
    const prev = { totalReads: 100, totalWrites: 40 }
    const next = { totalReads: 150, totalWrites: 50 }

    expect(sampleRate(prev, next, 5000)).toEqual({ readsPerSec: 10, writesPerSec: 2 })
  })

  it('returns undefined when elapsed time is zero or negative', () => {
    const prev = { totalReads: 100, totalWrites: 40 }
    const next = { totalReads: 150, totalWrites: 50 }

    expect(sampleRate(prev, next, 0)).toBeUndefined()
    expect(sampleRate(prev, next, -100)).toBeUndefined()
  })

  it('returns undefined on a read-counter reset (server restart) instead of a negative rate', () => {
    const prev = { totalReads: 500, totalWrites: 40 }
    const next = { totalReads: 10, totalWrites: 50 }

    expect(sampleRate(prev, next, 5000)).toBeUndefined()
  })

  it('returns undefined on a write-counter reset instead of a negative rate', () => {
    const prev = { totalReads: 100, totalWrites: 400 }
    const next = { totalReads: 150, totalWrites: 5 }

    expect(sampleRate(prev, next, 5000)).toBeUndefined()
  })

  it('treats an unchanged counter pair as a zero rate, not a reset', () => {
    const totals = { totalReads: 100, totalWrites: 40 }

    expect(sampleRate(totals, totals, 5000)).toEqual({ readsPerSec: 0, writesPerSec: 0 })
  })
})

describe('appendSample', () => {
  function sample(ts: number): RateSample {
    return { ts, readsPerSec: ts, writesPerSec: ts }
  }

  it('appends to an empty history', () => {
    expect(appendSample([], sample(1))).toEqual([sample(1)])
  })

  it('keeps history order, newest last', () => {
    const history = appendSample(appendSample([], sample(1)), sample(2))
    expect(history).toEqual([sample(1), sample(2)])
  })

  it('caps history at 60 samples, dropping the oldest', () => {
    let history: RateSample[] = []
    for (let i = 0; i < 65; i += 1) history = appendSample(history, sample(i))

    expect(history).toHaveLength(60)
    expect(history[0]).toEqual(sample(5))
    expect(history[59]).toEqual(sample(64))
  })
})
