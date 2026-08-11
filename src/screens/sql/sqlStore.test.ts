import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { addTab, closeTab, renameTab, resetSqlState, setTabExpand, updateTabParams, updateTabText, useSqlState } from './sqlStore'

beforeEach(() => {
  localStorage.clear()
  resetSqlState()
})

describe('sqlStore', () => {
  it('starts with a single untitled tab', () => {
    const { result } = renderHook(() => useSqlState())
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]?.name).toBe('untitled-1.sql')
    expect(result.current.activeId).toBe(result.current.tabs[0]?.id)
  })

  it('addTab appends untitled-2.sql with the given text and activates it', () => {
    const { result } = renderHook(() => useSqlState())
    let id = ''
    act(() => {
      id = addTab('SELECT 1')
    })
    expect(result.current.tabs).toHaveLength(2)
    expect(result.current.tabs[1]?.name).toBe('untitled-2.sql')
    expect(result.current.tabs[1]?.text).toBe('SELECT 1')
    expect(result.current.activeId).toBe(id)
  })

  it('persists tabs to localStorage and reloads them', () => {
    const { result } = renderHook(() => useSqlState())
    act(() => {
      addTab('SELECT 2')
    })
    act(() => {
      resetSqlState()
    })
    expect(result.current.tabs).toHaveLength(2)
    expect(result.current.tabs[1]?.text).toBe('SELECT 2')
  })

  it('falls back to a default tab on corrupt JSON', () => {
    localStorage.setItem('luradb.sqlTabs', '{not json')
    act(() => {
      resetSqlState()
    })
    const { result } = renderHook(() => useSqlState())
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]?.name).toBe('untitled-1.sql')
  })

  it('closing the active tab activates the left neighbor', () => {
    const { result } = renderHook(() => useSqlState())
    const first = result.current.tabs[0]?.id ?? ''
    let second = ''
    act(() => {
      second = addTab()
    })
    act(() => {
      closeTab(second)
    })
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.activeId).toBe(first)
  })

  it('closing the last remaining tab yields a fresh default tab', () => {
    const { result } = renderHook(() => useSqlState())
    const only = result.current.tabs[0]?.id ?? ''
    act(() => {
      closeTab(only)
    })
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]?.name).toBe('untitled-1.sql')
    expect(result.current.tabs[0]?.id).not.toBe(only)
  })

  it('rename, updateText, setExpand and updateParams mutate the target tab', () => {
    const { result } = renderHook(() => useSqlState())
    const id = result.current.tabs[0]?.id ?? ''
    act(() => {
      renameTab(id, 'orders.sql')
    })
    act(() => {
      updateTabText(id, 'SELECT 9')
    })
    act(() => {
      setTabExpand(id, ['ref'])
    })
    act(() => {
      updateTabParams(id, '["paid"]')
    })
    const tab = result.current.tabs[0]
    expect(tab?.name).toBe('orders.sql')
    expect(tab?.text).toBe('SELECT 9')
    expect(tab?.expand).toEqual(['ref'])
    expect(tab?.params).toBe('["paid"]')
  })

  it('persists the raw params text — even invalid JSON — across a reload simulation', () => {
    const { result } = renderHook(() => useSqlState())
    const id = result.current.tabs[0]?.id ?? ''
    act(() => {
      updateTabParams(id, '["paid, 42')
    })
    act(() => {
      resetSqlState()
    })
    expect(result.current.tabs[0]?.params).toBe('["paid, 42')
  })

  it('sanitizeTabs migrates old storage entries without a params field to an empty string', () => {
    localStorage.setItem(
      'luradb.sqlTabs',
      JSON.stringify({
        tabs: [{ id: 'old-1', name: 'legacy.sql', text: 'SELECT 1', expand: [] }],
        activeId: 'old-1',
      }),
    )
    act(() => {
      resetSqlState()
    })
    const { result } = renderHook(() => useSqlState())
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]?.params).toBe('')
  })
})
