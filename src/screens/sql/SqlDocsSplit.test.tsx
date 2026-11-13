import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppQueryClient } from '../../app/queryClient'
import { resetDocsState, useDocsState } from '../docs/docsStore'
import { server } from '../../test/msw'
import { SqlDocsSplit } from './SqlDocsSplit'

const SITE = 'https://docs.luradb.org'

function serve(path: string, content: string): void {
  server.use(
    http.get(
      `${SITE}${path}`,
      () =>
        new HttpResponse(`<!doctype html><html><body><h1>Site page ${path}</h1><div class="sl-markdown-content">${content}</div></body></html>`, {
          headers: { 'Content-Type': 'text/html' },
        }),
    ),
  )
}

function Probes() {
  const location = useLocation()
  const { activeId, search } = useDocsState()
  return (
    <>
      <p data-testid="route">{location.pathname}</p>
      <p data-testid="docs-active">{activeId ?? ''}</p>
      <p data-testid="docs-search">{search}</p>
    </>
  )
}

function renderSplit(articleId: string, onArticleChange: (id: string) => void = () => {}) {
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <MemoryRouter initialEntries={['/sql']}>
        <SqlDocsSplit articleId={articleId} onArticleChange={onArticleChange} onClose={() => {}} />
        <Probes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  resetDocsState()
})

describe('SqlDocsSplit', () => {
  it('shows the fetched LuraSQL page for the lurasql topic', async () => {
    serve('/using/lurasql/', '<h2 id="intro">LuraSQL test page</h2><p>Body</p>')
    const { container } = renderSplit('lurasql')

    expect(await screen.findByRole('heading', { name: 'LuraSQL test page' })).toBeInTheDocument()
    expect(screen.getByText('◈ docs · LuraSQL (rel engine)')).toBeInTheDocument()
    expect(container.querySelector('.docs__title')).toBeNull()
    expect(container.querySelector('.docs__source')).toHaveTextContent('docs.luradb.org/using/lurasql/')
  })

  it('falls back to the lurasql topic for an unknown id', async () => {
    serve('/using/lurasql/', '<h2 id="intro">LuraSQL test page</h2><p>Body</p>')
    renderSplit('nope')

    expect(await screen.findByRole('heading', { name: 'LuraSQL test page' })).toBeInTheDocument()
    expect(screen.getByText('◈ docs · LuraSQL (rel engine)')).toBeInTheDocument()
  })

  it('a site link in the content changes the page of the split', async () => {
    serve('/using/lurasql/', '<p>Keys are covered in <a href="/operating/security/">Security</a>.</p>')
    const onArticleChange = vi.fn()
    renderSplit('lurasql', onArticleChange)

    fireEvent.click(await screen.findByRole('link', { name: 'Security' }))

    expect(onArticleChange).toHaveBeenCalledWith('auth-permissions')
  })

  it('open full docs tab opens the topic in the docs store and navigates to /docs', async () => {
    renderSplit('cross-engine-links')

    fireEvent.click(await screen.findByRole('button', { name: 'open full docs tab →' }))

    expect(screen.getByTestId('docs-active')).toHaveTextContent('cross-engine-links')
    expect(screen.getByTestId('route')).toHaveTextContent('/docs')
  })

  it('submitting the search hands the text to the docs screen', () => {
    renderSplit('lurasql')
    const input = screen.getByLabelText('search docs')

    fireEvent.change(input, { target: { value: 'status' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(screen.getByTestId('docs-search')).toHaveTextContent('status')
    expect(screen.getByTestId('route')).toHaveTextContent('/docs')
  })
})
