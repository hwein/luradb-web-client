import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusCode } from './StatusCode'

describe('StatusCode', () => {
  it('colors 2xx as ok', () => {
    render(<StatusCode status={200} />)

    expect(screen.getByText('200')).toHaveClass('status-code__value--ok')
  })

  it('colors 4xx as err', () => {
    render(<StatusCode status={409} />)

    expect(screen.getByText('409')).toHaveClass('status-code__value--err')
  })

  it('colors 5xx as err', () => {
    render(<StatusCode status={500} />)

    expect(screen.getByText('500')).toHaveClass('status-code__value--err')
  })

  it('colors a network failure (status 0) as err', () => {
    render(<StatusCode status={0} />)

    expect(screen.getByText('0')).toHaveClass('status-code__value--err')
  })

  it('falls back to a neutral color outside 2xx/4xx/5xx', () => {
    render(<StatusCode status={304} />)

    expect(screen.getByText('304')).toHaveClass('status-code__value--neutral')
  })

  it('appends the duration when given, formatted to one decimal', () => {
    render(<StatusCode status={200} ms={3.14} />)

    expect(screen.getByText('· 3.1 ms')).toBeInTheDocument()
  })

  it('omits the duration when not given', () => {
    render(<StatusCode status={200} />)

    expect(screen.queryByText(/ms/)).not.toBeInTheDocument()
  })
})
