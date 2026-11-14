import { DOCS_HOST, DOCS_SITE, docsIdForSitePath } from './articles/articles'

export interface SitePage {
  title: string
  content: DocumentFragment
}

const ALLOWED = new Set(['p', 'h2', 'h3', 'h4', 'a', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'b', 'em'])
const DROPPED = new Set(['script', 'style', 'link', 'button', 'svg', 'select', 'iframe', 'figcaption'])
const ENDPOINT_PAGES = '/using/rest-api/endpoints'

function isDiagram(element: Element): boolean {
  return element.localName === 'svg' && element.getAttribute('role') === 'img' && !!element.getAttribute('aria-label')
}

function isDropped(element: Element): boolean {
  return DROPPED.has(element.localName) || element.classList.contains('sr-only') || element.classList.contains('sl-anchor-link')
}

function codeBlock(element: Element): HTMLElement {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  const lines = Array.from(element.querySelectorAll('.ec-line'), (line) => (line.textContent ?? '').replace(/\n$/, ''))
  code.append(document.createTextNode(lines.join('\n')))
  pre.append(code)
  return pre
}

/** A rebuilt site link, or undefined when the link stays plain text. */
function siteLink(href: string | null, pagePath: string): HTMLAnchorElement | undefined {
  if (href === null) return undefined
  let url: URL
  try {
    url = new URL(href, DOCS_SITE + pagePath)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.host !== DOCS_HOST) return undefined
  const anchor = url.hash.slice(1)
  const link = document.createElement('a')
  link.href = '#'
  link.className = 'docs-article__link'
  if (url.pathname === pagePath) {
    if (anchor === '') return undefined
  } else {
    if (url.pathname.startsWith(ENDPOINT_PAGES)) return undefined
    link.dataset.docsLink = docsIdForSitePath(url.pathname)
  }
  if (anchor !== '') link.dataset.docsAnchor = anchor
  return link
}

// Rebuilds foreign markup from scratch: only allowlisted elements, no foreign attribute ever survives.
function rebuild(node: Node, target: Node, pagePath: string, inParagraph: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    target.appendChild(document.createTextNode(node.textContent ?? ''))
    return
  }
  if (!(node instanceof Element)) return
  const element = node

  if (isDiagram(element)) {
    const label = document.createTextNode(element.getAttribute('aria-label') ?? '')
    if (inParagraph) {
      target.appendChild(label)
    } else {
      const paragraph = document.createElement('p')
      paragraph.append(label)
      target.appendChild(paragraph)
    }
    return
  }
  if (isDropped(element)) return
  if (element.classList.contains('expressive-code')) {
    target.appendChild(codeBlock(element))
    return
  }

  const name = element.localName
  let rebuilt: HTMLElement | undefined
  if (name === 'a') {
    rebuilt = siteLink(element.getAttribute('href'), pagePath)
  } else if (ALLOWED.has(name)) {
    rebuilt = document.createElement(name)
  }
  if (rebuilt === undefined) {
    for (const child of Array.from(element.childNodes)) rebuild(child, target, pagePath, inParagraph)
    return
  }

  // data-docs-id instead of id: a foreign id would become a window property.
  const id = element.getAttribute('id')
  if (id) rebuilt.dataset.docsId = id
  for (const child of Array.from(element.childNodes)) rebuild(child, rebuilt, pagePath, inParagraph || name === 'p')
  // Anchor icons (empty after the rebuild) would be invisible tab stops.
  if (name === 'a' && rebuilt.textContent?.trim() === '') return

  if (name === 'table') {
    const wrapper = document.createElement('div')
    wrapper.className = 'docs-article__table'
    wrapper.append(rebuilt)
    target.appendChild(wrapper)
  } else {
    target.appendChild(rebuilt)
  }
}

/** Fetches a page of DOCS_SITE without credentials and rebuilds its `.sl-markdown-content` by allowlist. */
export async function fetchSitePage(path: string): Promise<SitePage> {
  const response = await fetch(DOCS_SITE + path, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`${DOCS_HOST}${path} answered ${String(response.status)}`)
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
  const root = doc.querySelector('.sl-markdown-content')
  if (root === null) throw new Error(`${DOCS_HOST}${path} has no page content`)

  const content = document.createDocumentFragment()
  for (const child of Array.from(root.childNodes)) rebuild(child, content, path, false)
  return { title: doc.querySelector('h1')?.textContent?.trim() || path, content }
}
