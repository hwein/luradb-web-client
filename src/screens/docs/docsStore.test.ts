import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { activateTab, closeTab, openArticle, resetDocsState, setSearch, useDocsState } from './docsStore'

afterEach(() => {
  resetDocsState()
})

describe('docsStore', () => {
  it('opens a tab and activates it', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => openArticle('kv-engine'))

    expect(result.current.tabs).toEqual(['kv-engine'])
    expect(result.current.activeId).toBe('kv-engine')
  })

  it('does not duplicate a tab that is already open, just activates it', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => {
      openArticle('kv-engine')
      openArticle('lurasql')
      openArticle('kv-engine')
    })

    expect(result.current.tabs).toEqual(['kv-engine', 'lurasql'])
    expect(result.current.activeId).toBe('kv-engine')
  })

  it('activateTab switches the active tab among already-open tabs', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => {
      openArticle('kv-engine')
      openArticle('lurasql')
      activateTab('kv-engine')
    })

    expect(result.current.activeId).toBe('kv-engine')
    expect(result.current.tabs).toEqual(['kv-engine', 'lurasql'])
  })

  it('activateTab ignores an id that is not open', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => {
      openArticle('kv-engine')
      activateTab('lurasql')
    })

    expect(result.current.activeId).toBe('kv-engine')
  })

  it('closing the active tab activates its left neighbor', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => {
      openArticle('kv-engine')
      openArticle('lurasql')
      openArticle('cross-engine-links') // last opened ⇒ active
      closeTab('cross-engine-links')
    })

    expect(result.current.tabs).toEqual(['kv-engine', 'lurasql'])
    expect(result.current.activeId).toBe('lurasql')
  })

  it('closing a non-active tab leaves the active tab unchanged', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => {
      openArticle('kv-engine')
      openArticle('lurasql')
      closeTab('kv-engine')
    })

    expect(result.current.tabs).toEqual(['lurasql'])
    expect(result.current.activeId).toBe('lurasql')
  })

  it('closing the last remaining tab leaves no active tab', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => {
      openArticle('kv-engine')
      closeTab('kv-engine')
    })

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeId).toBeUndefined()
  })

  it('setSearch updates the search text', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => setSearch('kvref'))

    expect(result.current.search).toBe('kvref')
  })
})
