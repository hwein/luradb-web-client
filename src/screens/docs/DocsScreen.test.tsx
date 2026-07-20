import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { DocsScreen } from './DocsScreen'
import { resetDocsState } from './docsStore'

function SqlProbe() {
  const location = useLocation()
  const state = location.state as { insertQuery?: string } | null
  return <div data-testid="sql-probe">{state?.insertQuery ?? '(none)'}</div>
}

function renderDocsScreen(initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/docs']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/docs" element={<DocsScreen />} />
        <Route path="/sql" element={<SqlProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  resetDocsState()
})

describe('DocsScreen', () => {
  it('shows an empty-state hint until an article is opened', () => {
    renderDocsScreen()

    expect(screen.getByText(/Pick an article/)).toBeInTheDocument()
  })

  it('opens and activates an article tab when a category is clicked', () => {
    renderDocsScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))

    expect(screen.getByText('◈ docs://kv-engine')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Keys, values, and the null state' })).toBeInTheDocument()
  })

  it('closes the active tab and falls back to its left neighbor', () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'LuraSQL (rel engine)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cross-engine links' })) // last opened ⇒ active

    fireEvent.click(screen.getByLabelText('close cross-engine-links'))

    expect(screen.queryByText('◈ docs://cross-engine-links')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A deliberately small SQL dialect' })).toBeInTheDocument()
  })

  it('closing a non-active tab leaves the active article untouched', () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'LuraSQL (rel engine)' })) // last opened ⇒ active

    fireEvent.click(screen.getByLabelText('close kv-engine'))

    expect(screen.queryByText('◈ docs://kv-engine')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A deliberately small SQL dialect' })).toBeInTheDocument()
  })

  it('typing in the search box replaces the category list with matches and a context line', () => {
    renderDocsScreen()

    fireEvent.change(screen.getByLabelText('search docs'), { target: { value: 'KVREF' } })

    expect(screen.getByText('KVREF & JSONREF columns')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Getting started' })).not.toBeInTheDocument()
  })

  it('focuses the search input on arrival with focusSearch router state, and does not refocus on the next render', () => {
    renderDocsScreen([{ pathname: '/docs', state: { focusSearch: true } }])

    const input = screen.getByLabelText('search docs')
    expect(input).toHaveFocus()

    input.blur()
    fireEvent.click(screen.getByRole('button', { name: 'Getting started' }))

    expect(input).not.toHaveFocus()
  })

  it('"try in the console" chip navigates to /sql carrying the example query as router state', () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'LuraSQL (rel engine)' }))

    fireEvent.click(screen.getByRole('button', { name: 'try in the console →' }))

    expect(screen.getByTestId('sql-probe')).toHaveTextContent("SELECT o.id, o.total FROM orders AS o WHERE o.status = 'paid' LIMIT 50")
  })

  it('a related chip opens the target article as a new tab', () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Cross-engine links' }))

    fireEvent.click(screen.getByRole('button', { name: 'related: LuraSQL · LEFT JOIN' }))

    expect(screen.getByText('◈ docs://lurasql')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A deliberately small SQL dialect' })).toBeInTheDocument()
  })

  it('an inline docs: link inside the article body opens the target article', () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Domains & isolation' }))

    fireEvent.click(screen.getByRole('link', { name: 'errors & status codes' }))

    expect(screen.getByRole('heading', { name: 'What the status code is telling you' })).toBeInTheDocument()
  })

  it('shows a swagger reference link', () => {
    renderDocsScreen()

    const link = screen.getByRole('link', { name: 'swagger /test-ui ↗' })
    expect(link).toHaveAttribute('href', `${window.location.origin}/test-ui`)
  })
})
