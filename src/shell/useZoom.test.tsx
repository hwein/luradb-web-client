import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setZoom = vi.fn()

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom }),
}))

import { useZoom } from './useZoom'

function Probe() {
  useZoom()
  return null
}

describe('useZoom', () => {
  beforeEach(() => {
    setZoom.mockReset()
    setZoom.mockResolvedValue(undefined)
    localStorage.setItem('luradb.zoom', '1.5')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies the stored zoom on mount in desktop mode', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    render(<Probe />)
    expect(setZoom).toHaveBeenCalledTimes(1)
    expect(setZoom).toHaveBeenCalledWith(1.5)
  })

  it('does not set the webview zoom on mount in browser mode', () => {
    render(<Probe />)
    expect(setZoom).not.toHaveBeenCalled()
  })

  describe('shortcuts', () => {
    function press(init: KeyboardEventInit): boolean {
      return fireEvent.keyDown(window, init)
    }

    function desktop(stored = '1') {
      vi.stubGlobal('__TAURI_INTERNALS__', {})
      localStorage.setItem('luradb.zoom', stored)
      render(<Probe />)
      setZoom.mockClear()
    }

    it('Ctrl+= zooms in one step in desktop mode and prevents the default', () => {
      desktop()
      expect(press({ key: '=', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenCalledTimes(1)
      expect(setZoom).toHaveBeenCalledWith(1.1)
    })

    it('Ctrl++ and Ctrl+NumpadAdd zoom in one step', () => {
      desktop()
      expect(press({ key: '+', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1.1)
      expect(press({ code: 'NumpadAdd', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1.25)
      expect(setZoom).toHaveBeenCalledTimes(2)
    })

    it('Ctrl+- and Ctrl+NumpadSubtract zoom out one step', () => {
      desktop()
      expect(press({ key: '-', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(0.9)
      expect(press({ code: 'NumpadSubtract', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(0.8)
      expect(setZoom).toHaveBeenCalledTimes(2)
    })

    it('Ctrl+0 and Ctrl+Numpad0 reset the zoom to 1', () => {
      desktop('1.5')
      expect(press({ key: '0', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1)
      localStorage.setItem('luradb.zoom', '2')
      expect(press({ code: 'Numpad0', ctrlKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1)
      expect(setZoom).toHaveBeenCalledTimes(2)
    })

    it('Meta works in place of Ctrl for the zoom shortcuts', () => {
      desktop()
      expect(press({ key: '=', metaKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1.1)
      expect(press({ key: '-', metaKey: true })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1)
      expect(press({ key: '0', metaKey: true })).toBe(false)
      expect(setZoom).toHaveBeenCalledTimes(3)
    })

    it('zoom shortcuts work while a focused element stops keydown propagation', () => {
      desktop()
      const editor = document.createElement('div')
      editor.addEventListener('keydown', (event) => event.stopPropagation())
      document.body.appendChild(editor)
      try {
        expect(fireEvent.keyDown(editor, { key: '=', ctrlKey: true })).toBe(false)
        expect(setZoom).toHaveBeenCalledTimes(1)
        expect(setZoom).toHaveBeenCalledWith(1.1)
      } finally {
        editor.remove()
      }
    })

    it('AltGr (ctrl+alt) never triggers a zoom shortcut', () => {
      desktop()
      expect(press({ key: '+', ctrlKey: true, altKey: true })).toBe(true)
      expect(press({ key: '-', ctrlKey: true, altKey: true })).toBe(true)
      expect(press({ key: '0', ctrlKey: true, altKey: true })).toBe(true)
      expect(setZoom).not.toHaveBeenCalled()
    })

    it('zoom shortcuts do nothing in browser mode and leave the default alone', () => {
      render(<Probe />)
      expect(press({ key: '=', ctrlKey: true })).toBe(true)
      expect(press({ key: '-', ctrlKey: true })).toBe(true)
      expect(press({ key: '0', ctrlKey: true })).toBe(true)
      expect(setZoom).not.toHaveBeenCalled()
    })

    it('Ctrl+wheel up zooms in and Ctrl+wheel down zooms out in desktop mode', () => {
      desktop()
      expect(fireEvent.wheel(window, { ctrlKey: true, deltaY: -100 })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1.1)
      expect(fireEvent.wheel(window, { ctrlKey: true, deltaY: 100 })).toBe(false)
      expect(setZoom).toHaveBeenLastCalledWith(1)
      expect(setZoom).toHaveBeenCalledTimes(2)
    })

    it('a wheel event without Ctrl leaves the zoom untouched', () => {
      desktop()
      expect(fireEvent.wheel(window, { deltaY: -100 })).toBe(true)
      expect(fireEvent.wheel(window, { ctrlKey: true, altKey: true, deltaY: 100 })).toBe(true)
      expect(setZoom).not.toHaveBeenCalled()
    })

    it('Ctrl+wheel does nothing in browser mode', () => {
      render(<Probe />)
      expect(fireEvent.wheel(window, { ctrlKey: true, deltaY: -100 })).toBe(true)
      expect(setZoom).not.toHaveBeenCalled()
    })
  })
})
