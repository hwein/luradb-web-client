import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppQueryClient } from '../../app/queryClient'
import { server } from '../../test/msw'
import { DocsScreen } from './DocsScreen'
import { resetDocsState } from './docsStore'
import { openDocs } from './openDocs'

const SITE = 'https://docs.luradb.org'

function pageHtml(path: string, content: string): string {
  return `<!doctype html><html><body><h1>Site page ${path}</h1><div class="sl-markdown-content">${content}</div></body></html>`
}

function serve(path: string, content: string): void {
  server.use(http.get(`${SITE}${path}`, () => new HttpResponse(pageHtml(path, content), { headers: { 'Content-Type': 'text/html' } })))
}

function renderDocsScreen(initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/docs']) {
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/docs" element={<DocsScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubScrollIntoView(): { scrolled: Element[]; scrolledTabs: Element[] } {
  const scrolled: Element[] = []
  const scrolledTabs: Element[] = []
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    const list = this.classList.contains('docs__tab') ? scrolledTabs : scrolled
    list.push(this)
  }
  return { scrolled, scrolledTabs }
}

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  resetDocsState()
})

describe('DocsScreen', () => {
  it('shows an empty-state hint until an article is opened', () => {
    renderDocsScreen()

    expect(screen.getByText(/Pick an article/)).toBeInTheDocument()
  })

  it('opens a remote topic as a tab and shows the fetched page in the article view', async () => {
    const { container } = renderDocsScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))

    expect(screen.getByText('◈ docs://kv-engine')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /using/key-value/' })).toBeInTheDocument()
    expect(screen.getByText('Content of /using/key-value/')).toBeInTheDocument()
    expect(container.querySelector('.docs__kicker')).toHaveTextContent('Key-Value engine')
    expect(container.querySelector('.docs__source')).toHaveTextContent('docs.luradb.org/using/key-value/')
  })

  it('shows a network hint with retry when the site cannot be reached', async () => {
    server.use(http.get(`${SITE}/*`, () => HttpResponse.error(), { once: true }))
    renderDocsScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))

    expect(await screen.findByText('This page lives on docs.luradb.org and could not be loaded.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    expect(await screen.findByRole('heading', { name: 'Site page /using/key-value/' })).toBeInTheDocument()
  })

  it('shows loading while the page is fetched', async () => {
    server.use(
      http.get(`${SITE}/using/key-value/`, async () => {
        await delay(50)
        return new HttpResponse(pageHtml('/using/key-value/', '<p>late</p>'), { headers: { 'Content-Type': 'text/html' } })
      }),
    )
    renderDocsScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))

    expect(screen.getByText('loading…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /using/key-value/' })).toBeInTheDocument()
    expect(screen.queryByText('loading…')).not.toBeInTheDocument()
  })

  it('a site link in the content opens that page as a new tab', async () => {
    serve('/using/key-value/', '<p>See <a href="/operating/configuration/">Configuration</a>.</p>')
    const { container } = renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))

    fireEvent.click(await screen.findByRole('link', { name: 'Configuration' }))

    expect(screen.getByText('◈ docs://operating/configuration')).toBeInTheDocument()
    expect(screen.getByText('◈ docs://kv-engine')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /operating/configuration/' })).toBeInTheDocument()
    expect(container.querySelector('.docs__kicker')).toHaveTextContent('docs.luradb.org')
  })

  it('a site link with an anchor opens the page and scrolls to the anchor', async () => {
    const { scrolled } = stubScrollIntoView()
    serve('/using/key-value/', '<p>See <a href="/operating/configuration/#rel-enabled">rel.enabled</a>.</p>')
    serve('/operating/configuration/', '<dl><dt id="rel-enabled">rel.enabled</dt><dd>Switches the engine.</dd></dl>')
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))

    fireEvent.click(await screen.findByRole('link', { name: 'rel.enabled' }))

    expect(await screen.findByRole('heading', { name: 'Site page /operating/configuration/' })).toBeInTheDocument()
    expect(screen.getByText('◈ docs://operating/configuration')).toBeInTheDocument()
    await waitFor(() => expect(scrolled.map((element) => element.getAttribute('data-docs-id'))).toEqual(['rel-enabled']))
    expect(scrolled[0]?.isConnected).toBe(true)
  })

  it('a hash link scrolls to the heading inside the article', async () => {
    const { scrolled } = stubScrollIntoView()
    serve('/using/key-value/', '<h2 id="views">Views</h2><p>Jump to <a href="#views">views</a>.</p>')
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    const link = await screen.findByRole('link', { name: 'views' })
    const address = window.location.href

    fireEvent.click(link)

    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]?.localName).toBe('h2')
    expect(scrolled[0]?.getAttribute('data-docs-id')).toBe('views')
    expect(window.location.href).toBe(address)
    expect(screen.getByText('◈ docs://kv-engine')).toBeInTheDocument()
  })

  it('scrolls to the section of the cross-engine-links topic', async () => {
    const { scrolled } = stubScrollIntoView()
    serve('/using/lurasql/', '<p>Intro</p><h2 id="a-reference-can-embed-the-row-it-points-to">References</h2><p>Text</p>')
    act(() => openDocs('cross-engine-links'))

    renderDocsScreen()

    expect(await screen.findByRole('heading', { name: 'Site page /using/lurasql/' })).toBeInTheDocument()
    await waitFor(() =>
      expect(scrolled.map((element) => element.getAttribute('data-docs-id'))).toEqual(['a-reference-can-embed-the-row-it-points-to']),
    )
  })

  it('switching from the cross-engine-links topic to the lurasql topic scrolls back to the top', async () => {
    const { scrolled } = stubScrollIntoView()
    serve('/using/lurasql/', '<p>Intro</p><h2 id="a-reference-can-embed-the-row-it-points-to">References</h2><p>Text</p>')
    act(() => openDocs('cross-engine-links'))
    const { container } = renderDocsScreen()
    await waitFor(() => expect(scrolled).toHaveLength(1))
    const article = container.querySelector('.docs__article')
    if (article === null) throw new Error('no .docs__article')
    article.scrollTop = 120

    fireEvent.click(screen.getByRole('button', { name: 'LuraSQL (rel engine)' }))

    expect(screen.getByText('◈ docs://lurasql')).toBeInTheDocument()
    await waitFor(() => expect(article.scrollTop).toBe(0))
  })

  it('scrolls the active tab into view when a tab opens and when it is activated', async () => {
    const { scrolledTabs } = stubScrollIntoView()
    const { container } = renderDocsScreen()
    const lastScrolledIsActive = () => {
      const active = container.querySelector('.docs__tab--active')
      expect(active).not.toBeNull()
      expect(scrolledTabs.at(-1)).toBe(active)
    }

    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    await waitFor(lastScrolledIsActive)
    expect(container.querySelector('.docs__tab--active')).toHaveTextContent('◈ docs://kv-engine')

    fireEvent.click(screen.getByRole('button', { name: 'JSON documents & indexes' }))
    await waitFor(lastScrolledIsActive)
    expect(container.querySelector('.docs__tab--active')).not.toHaveTextContent('◈ docs://kv-engine')

    fireEvent.click(screen.getByRole('button', { name: '◈ docs://kv-engine' }))
    await waitFor(lastScrolledIsActive)
    expect(container.querySelector('.docs__tab--active')).toHaveTextContent('◈ docs://kv-engine')
  })

  it('switching from the scrolled local article to a fetched page scrolls back to the top', async () => {
    const { container } = renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    expect(await screen.findByRole('heading', { name: 'Site page /using/key-value/' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Getting started' }))
    const article = container.querySelector('.docs__article')
    if (article === null) throw new Error('no .docs__article')
    article.scrollTop = 120

    fireEvent.click(screen.getByRole('button', { name: '◈ docs://kv-engine' }))

    expect(await screen.findByRole('heading', { name: 'Site page /using/key-value/' })).toBeInTheDocument()
    await waitFor(() => expect(article.scrollTop).toBe(0))
  })

  it('opens the local article from the category list', () => {
    const { container } = renderDocsScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Getting started' }))

    expect(screen.getByText('◈ docs://getting-started')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Connect to a running server' })).toBeInTheDocument()
    expect(container.querySelector('.docs__source')).toBeNull()
  })

  it('a related chip of getting-started opens the remote topic as a new tab', async () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Getting started' }))

    fireEvent.click(screen.getByRole('button', { name: 'related: Domains & isolation' }))

    expect(screen.getByText('◈ docs://domains-isolation')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /how-it-works/domains-and-engines/' })).toBeInTheDocument()
  })

  it('the docs:mcp link in getting-started opens the MCP topic', async () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Getting started' }))

    fireEvent.click(screen.getByRole('link', { name: 'MCP' }))

    expect(screen.getByText('◈ docs://mcp')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /using/mcp-server/' })).toBeInTheDocument()
  })

  it('closes the active tab and falls back to its left neighbor', async () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'LuraSQL (rel engine)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cross-engine links' })) // last opened ⇒ active

    fireEvent.click(screen.getByLabelText('close cross-engine-links'))

    expect(screen.queryByText('◈ docs://cross-engine-links')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /using/lurasql/' })).toBeInTheDocument()
  })

  it('closing a non-active tab leaves the active article untouched', async () => {
    renderDocsScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Key-Value engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'LuraSQL (rel engine)' })) // last opened ⇒ active

    fireEvent.click(screen.getByLabelText('close kv-engine'))

    expect(screen.queryByText('◈ docs://kv-engine')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Site page /using/lurasql/' })).toBeInTheDocument()
  })

  it('typing in the search box replaces the category list with matches and a context line', () => {
    renderDocsScreen()

    fireEvent.change(screen.getByLabelText('search docs'), { target: { value: 'KVREF' } })

    expect(screen.getByText('KVREF & JSONREF columns')).toBeInTheDocument()
    expect(screen.getByText('docs.luradb.org')).toBeInTheDocument()
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
})
