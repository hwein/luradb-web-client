import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDesktopGuards } from './useDesktopGuards'

function Probe() {
  useDesktopGuards()
  return null
}

function desktop(): void {
  vi.stubGlobal('__TAURI_INTERNALS__', {})
  render(<Probe />)
}

function contextMenuOn(element: Element): boolean {
  return fireEvent.contextMenu(element)
}

function press(init: KeyboardEventInit): boolean {
  return fireEvent.keyDown(window, init)
}

function append<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  document.body.appendChild(element)
  return element
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
})

describe('useDesktopGuards', () => {
  it('blocks the context menu on a plain element in desktop mode', () => {
    desktop()
    expect(contextMenuOn(append('div'))).toBe(false)
  })

  it('keeps the context menu on input, textarea, contenteditable and .cm-editor targets', () => {
    desktop()
    const editable = append('div')
    editable.setAttribute('contenteditable', 'true')
    const editor = append('div')
    editor.className = 'cm-editor'
    const line = document.createElement('span')
    editor.appendChild(line)

    expect(contextMenuOn(append('input'))).toBe(true)
    expect(contextMenuOn(append('textarea'))).toBe(true)
    expect(contextMenuOn(editable)).toBe(true)
    expect(contextMenuOn(line)).toBe(true)
  })

  it('never blocks the context menu in browser mode', () => {
    render(<Probe />)
    expect(contextMenuOn(append('div'))).toBe(true)
  })

  it('blocks F5, Ctrl+R, Ctrl+P and Ctrl+F in desktop mode', () => {
    desktop()
    expect(press({ key: 'F5' })).toBe(false)
    expect(press({ key: 'F5', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(press({ key: 'r', ctrlKey: true })).toBe(false)
    expect(press({ key: 'R', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(press({ key: 'p', ctrlKey: true })).toBe(false)
    expect(press({ key: 'f', metaKey: true })).toBe(false)
  })

  it('leaves F1, Ctrl+K and AltGr+R untouched in desktop mode', () => {
    desktop()
    expect(press({ key: 'F1' })).toBe(true)
    expect(press({ key: 'k', ctrlKey: true })).toBe(true)
    expect(press({ key: 'r', ctrlKey: true, altKey: true })).toBe(true)
    expect(press({ key: 'r' })).toBe(true)
  })

  it('blocks F12 and Ctrl+Shift+I only outside the dev profile', () => {
    desktop()
    vi.stubEnv('DEV', true)
    expect(press({ key: 'F12' })).toBe(true)
    expect(press({ key: 'I', ctrlKey: true, shiftKey: true })).toBe(true)

    vi.stubEnv('DEV', false)
    expect(press({ key: 'F12' })).toBe(false)
    expect(press({ key: 'I', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(press({ key: 'i', ctrlKey: true })).toBe(true)
  })

  it('blocks no key in browser mode', () => {
    vi.stubEnv('DEV', false)
    render(<Probe />)
    expect(press({ key: 'F5' })).toBe(true)
    expect(press({ key: 'r', ctrlKey: true })).toBe(true)
    expect(press({ key: 'p', ctrlKey: true })).toBe(true)
    expect(press({ key: 'f', ctrlKey: true })).toBe(true)
    expect(press({ key: 'F12' })).toBe(true)
    expect(press({ key: 'I', ctrlKey: true, shiftKey: true })).toBe(true)
  })
})
