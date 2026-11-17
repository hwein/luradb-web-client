import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import './DocsScreen.css'
import { DOCS_HOST, getDocEntry, resolveSitePage } from './articles/articles'
import { fetchSitePage } from './sitePage'

interface SitePageViewProps {
  id: string
  anchor?: string
  heading?: boolean
  onOpen: (id: string, anchor?: string) => void
}

// Looped over data-docs-id: the foreign anchor never becomes part of a selector.
function scrollToAnchor(container: HTMLElement | null, anchor: string | undefined): void {
  if (container === null || anchor === undefined) return
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-docs-id]'))) {
    if (element.dataset.docsId === anchor) {
      element.scrollIntoView?.()
      return
    }
  }
}

/** A page of the docs site in the article anatomy: kicker, title, rebuilt content, source line. */
export function SitePageView({ id, anchor, heading = true, onOpen }: SitePageViewProps) {
  const path = resolveSitePage(id)?.path
  const query = useQuery({
    queryKey: ['docs-site', path],
    queryFn: () => fetchSitePage(path ?? '/'),
    enabled: path !== undefined,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const page = query.data

  useEffect(() => {
    if (page) contentRef.current?.replaceChildren(page.content.cloneNode(true))
  }, [page])

  // Without an anchor, the page starts at the top of its scroll container (the parent element).
  useEffect(() => {
    if (!page) return
    const container = rootRef.current?.parentElement
    if (anchor !== undefined) scrollToAnchor(contentRef.current, anchor)
    else if (container) container.scrollTop = 0
  }, [page, id, anchor])

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest('[data-docs-link], [data-docs-anchor]')
    if (!(link instanceof HTMLElement)) return
    event.preventDefault()
    const { docsLink, docsAnchor } = link.dataset
    if (docsLink !== undefined) {
      onOpen(docsLink, docsAnchor)
    } else {
      scrollToAnchor(contentRef.current, docsAnchor)
    }
  }

  if (query.isError) {
    return (
      <div className="docs__offline">
        <span>{`This page lives on ${DOCS_HOST} and could not be loaded.`}</span>
        <button type="button" className="docs__chip" onClick={() => void query.refetch()}>
          retry
        </button>
      </div>
    )
  }
  if (!page) return <div className="docs__empty">loading…</div>

  return (
    <div className="docs__article-inner selectable" ref={rootRef}>
      {heading && (
        <>
          <div className="docs__kicker mono-label">{getDocEntry(id)?.category ?? DOCS_HOST}</div>
          <h1 className="docs__title">{page.title}</h1>
        </>
      )}
      <div className="docs-article" ref={contentRef} onClick={handleClick} />
      <div className="docs__source">{`${DOCS_HOST}${path ?? ''}`}</div>
    </div>
  )
}
