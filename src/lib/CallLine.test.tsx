import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CallLine } from './CallLine'

describe('CallLine', () => {
  it('renders method and path without a note', () => {
    render(<CallLine method="GET" path="/store-api/domains" />)

    expect(screen.getByText('GET /store-api/domains')).toBeInTheDocument()
  })

  it('appends the note after a middot separator, matching the "Show the call" pattern', () => {
    render(<CallLine method="POST" path="/store-api/json/shop/search" note='body {"filter":{"city":"Essen"}}' />)

    expect(screen.getByText('POST /store-api/json/shop/search · body {"filter":{"city":"Essen"}}')).toBeInTheDocument()
  })
})
