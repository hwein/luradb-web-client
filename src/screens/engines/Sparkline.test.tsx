import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sparkline } from './Sparkline'

function barHeights(values: number[]): string[] {
  const { container } = render(<Sparkline values={values} />)
  return Array.from(container.querySelectorAll<HTMLElement>('.engines__spark-bar')).map((bar) => bar.style.height)
}

describe('Sparkline', () => {
  it('scales the bars to the largest value with a 2px floor', () => {
    expect(barHeights([0, 1, 2, 4])).toEqual([...Array<string>(8).fill('2px'), '2px', '9px', '18px', '36px'])
    expect(barHeights([])).toEqual(Array<string>(12).fill('2px'))
  })
})
