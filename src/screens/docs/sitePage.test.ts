import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api'
import { server } from '../../test/msw'
import { fetchSitePage } from './sitePage'

const SITE = 'https://docs.luradb.org'

const ALLOWED = ['p', 'h2', 'h3', 'h4', 'a', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'b', 'em']

function sitePage(content: string): string {
  return `<!doctype html><html><head><title>Tab title</title><script>window.headScript = 1</script></head><body>
<header class="header"><a href="/">Site header navigation</a></header>
<main><h1 id="_top"> LuraSQL </h1>
<div class="sl-markdown-content">${content}</div></main></body></html>`
}

const FULL_CONTENT = `
<p class="intro" style="color: red" onclick="alert(1)">Intro <strong>bold</strong> <b>b</b> <em>em</em> <code>inline</code> text.</p>
<div class="sl-heading-wrapper level-h2"><h2 id="views">Views</h2><a class="sl-anchor-link" href="#views"><span aria-hidden="true">#</span><span class="sr-only">Section titled Views</span></a></div>
<div class="sl-heading-wrapper level-h2"><h2 id="__TAURI_INTERNALS__">Tauri</h2></div>
<div class="expressive-code"><link rel="stylesheet" href="/ec.css"><script type="module">window.ecScript = 1</script><figure class="frame"><figcaption class="header"><span class="title">example.sql</span></figcaption><pre data-language="sql"><code><div class="ec-line"><div class="code"><span style="--0:#ff79c6">SELECT</span><span style="--0:#f8f8f2"> 1</span></div></div><div class="ec-line"><div class="code"><span style="--0:#ff79c6">FROM</span><span> t</span></div></div></code></pre><div class="copy"><button title="Copy to clipboard" data-code="SELECT 1">Copy code</button></div></figure></div>
<table class="wide"><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>
<ul><li>First item</li></ul>
<ol><li>Step</li></ol>
<dl><dt id="rel-enabled">rel.enabled</dt><dd>Switches the engine.</dd></dl>
<style>.x { color: red }</style>
<iframe src="https://example.com">Frame text</iframe>
<select><option>Option text</option></select>
<svg viewBox="0 0 1 1"><text>Icon text</text></svg>
<button>Button text</button>
<div class="related"><p>Related <a href="/using/key-value/">Key-value</a></p></div>
`

function serve(path: string, html: string): void {
  server.use(http.get(`${SITE}${path}`, () => new HttpResponse(html, { headers: { 'Content-Type': 'text/html' } })))
}

function tagNames(fragment: DocumentFragment): string[] {
  return Array.from(fragment.querySelectorAll('*')).map((element) => element.localName)
}

describe('fetchSitePage', () => {
  it('returns the title and the content of .sl-markdown-content', async () => {
    serve('/using/lurasql/', sitePage(FULL_CONTENT))

    const page = await fetchSitePage('/using/lurasql/')

    expect(page.title).toBe('LuraSQL')
    expect(page.content.textContent).toContain('Intro')
    expect(page.content.textContent).toContain('First item')
    expect(page.content.textContent).not.toContain('Site header navigation')
    expect(page.content.textContent).not.toContain('LuraSQL')
  })

  it('rebuilds a code block as plain pre and code with one line per ec-line', async () => {
    serve('/using/lurasql/', sitePage(FULL_CONTENT))

    const { content } = await fetchSitePage('/using/lurasql/')

    const blocks = content.querySelectorAll('pre > code')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.textContent).toBe('SELECT 1\nFROM t')
    expect(content.querySelector('span')).toBeNull()
    expect(content.querySelector('figure')).toBeNull()
    expect(content.textContent).not.toContain('example.sql')
  })

  it('keeps only allowlisted elements and drops script, style, link, button, svg and iframe', async () => {
    serve('/using/lurasql/', sitePage(FULL_CONTENT))

    const { content } = await fetchSitePage('/using/lurasql/')

    for (const name of tagNames(content)) {
      expect([...ALLOWED, 'div']).toContain(name)
    }
    for (const div of Array.from(content.querySelectorAll('div'))) {
      expect(div.className).toBe('docs-article__table')
      expect(div.firstElementChild?.localName).toBe('table')
    }
    const text = content.textContent ?? ''
    for (const dropped of ['Button text', 'Copy code', 'Frame text', 'Option text', 'Icon text', 'color: red', 'ecScript', 'Section titled']) {
      expect(text).not.toContain(dropped)
    }
    expect(content.querySelectorAll('div.docs-article__table > table')).toHaveLength(1)
  })

  it('drops every attribute except heading ids', async () => {
    serve('/using/lurasql/', sitePage(FULL_CONTENT))

    const { content } = await fetchSitePage('/using/lurasql/')

    for (const name of ['onclick', 'style', 'id', 'title', 'data-code', 'data-language']) {
      expect(content.querySelector(`[${name}]`)).toBeNull()
    }
    expect(content.querySelector('[class]:not(.docs-article__table):not(.docs-article__link)')).toBeNull()
    expect(content.querySelector('h2[data-docs-id="views"]')).not.toBeNull()
    expect(content.querySelector('dt[data-docs-id="rel-enabled"]')).not.toBeNull()

    const host = document.createElement('div')
    host.append(content)
    document.body.append(host)
    try {
      expect('__TAURI_INTERNALS__' in window).toBe(false)
    } finally {
      host.remove()
    }
  })

  it('turns a site link into a docs link and a hash link into an anchor link', async () => {
    serve(
      '/using/json-documents/',
      sitePage(
        '<p><a href="/using/lurasql/">LuraSQL</a> <a href="/operating/configuration/#rel-enabled">rel.enabled</a> <a href="#views">Views</a></p>',
      ),
    )
    serve('/using/lurasql/', sitePage('<p><a href="../key-value/">Key-value</a></p>'))

    const { content } = await fetchSitePage('/using/json-documents/')
    const [lurasql, configuration, views] = Array.from(content.querySelectorAll('a'))

    expect(lurasql?.dataset.docsLink).toBe('lurasql')
    expect(lurasql?.dataset.docsAnchor).toBeUndefined()
    expect(configuration?.dataset.docsLink).toBe('/operating/configuration/')
    expect(configuration?.dataset.docsAnchor).toBe('rel-enabled')
    expect(views?.dataset.docsLink).toBeUndefined()
    expect(views?.dataset.docsAnchor).toBe('views')
    for (const link of [lurasql, configuration, views]) {
      expect(link?.getAttribute('href')).toBe('#')
      expect(link?.className).toBe('docs-article__link')
    }

    const relative = await fetchSitePage('/using/lurasql/')
    expect(relative.content.querySelector('a')?.dataset.docsLink).toBe('kv-engine')
  })

  it('renders links to other hosts, javascript: links and endpoint pages as plain text', async () => {
    serve(
      '/using/lurasql/',
      sitePage(
        '<p><a href="https://github.com/luradb/luradb">GitHub</a> <a href="javascript:alert(1)">Script</a> <a href="/using/rest-api/endpoints/operations/get_key/">Get key</a> <a href="/./using/rest-api/endpoints">Endpoints</a></p>',
      ),
    )

    const { content } = await fetchSitePage('/using/lurasql/')

    expect(content.querySelector('a')).toBeNull()
    for (const text of ['GitHub', 'Script', 'Get key', 'Endpoints']) {
      expect(content.textContent).toContain(text)
    }
  })

  it('replaces a labelled diagram with its description', async () => {
    serve('/using/mcp-server/', sitePage('<div><svg role="img" aria-label="Flow"><text>Inner</text></svg></div>'))

    const { content } = await fetchSitePage('/using/mcp-server/')

    const paragraphs = content.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]?.textContent).toBe('Flow')
    expect(content.querySelector('svg')).toBeNull()
  })

  it('rejects a page without .sl-markdown-content', async () => {
    serve('/using/lurasql/', '<!doctype html><html><body><h1>No content</h1></body></html>')

    const error: unknown = await fetchSitePage('/using/lurasql/').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ApiError)
  })

  it('rejects a response that is not ok with a plain Error', async () => {
    server.use(http.get(`${SITE}/using/lurasql/`, () => new HttpResponse('unauthorized', { status: 401 })))

    const error: unknown = await fetchSitePage('/using/lurasql/').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ApiError)
  })

  it('fetches without credentials and without referrer', async () => {
    let credentials: string | undefined
    let referrerPolicy: string | undefined
    server.use(
      http.get(`${SITE}/using/lurasql/`, ({ request }) => {
        credentials = request.credentials
        referrerPolicy = request.referrerPolicy
        return new HttpResponse(sitePage('<p>x</p>'), { headers: { 'Content-Type': 'text/html' } })
      }),
    )

    await fetchSitePage('/using/lurasql/')

    expect(credentials).toBe('omit')
    expect(referrerPolicy).toBe('no-referrer')
  })
})
