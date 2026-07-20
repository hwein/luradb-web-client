import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDocsState, resetDocsState } from './docsStore'
import { openDocs } from './openDocs'

afterEach(() => {
  resetDocsState()
})

describe('openDocs', () => {
  it('opens the article tab and activates it, given an article id', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => openDocs('kv-engine'))

    expect(result.current.tabs).toEqual(['kv-engine'])
    expect(result.current.activeId).toBe('kv-engine')
  })

  it('sets the search text, given a { search } target', () => {
    const { result } = renderHook(() => useDocsState())

    act(() => openDocs({ search: 'expand' }))

    expect(result.current.search).toBe('expand')
    expect(result.current.tabs).toEqual([])
  })
})
