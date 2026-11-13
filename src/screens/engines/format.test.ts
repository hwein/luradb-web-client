import { describe, expect, it } from 'vitest'
import { formatLatency, formatRate } from './format'

describe('formatRate', () => {
  it('formats a rate as 0, with one decimal below 10 and as a grouped integer from 10', () => {
    expect(formatRate(0)).toBe('0')
    expect(formatRate(200 / 60)).toBe('3.3')
    expect(formatRate(5)).toBe('5.0')
    expect(formatRate(10)).toBe('10')
    expect(formatRate(18440)).toBe('18,440')
  })

  it('marks a positive rate that would round to 0.0', () => {
    expect(formatRate(1 / 60)).toBe('<0.1')
    expect(formatRate(2 / 60)).toBe('<0.1')
    expect(formatRate(6 / 60)).toBe('0.1')
  })
})

describe('formatLatency', () => {
  it('formats a latency in µs below 1000 and in ms with one decimal from 1000', () => {
    expect(formatLatency(5)).toBe('5 µs')
    expect(formatLatency(500)).toBe('500 µs')
    expect(formatLatency(5000)).toBe('5.0 ms')
    expect(formatLatency(500000)).toBe('500.0 ms')
  })
})
