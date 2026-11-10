import { beforeEach, describe, expect, it, vi } from 'vitest'

const setZoom = vi.fn()

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom }),
}))

import { ZOOM_STEPS, applyZoom, readZoom, zoomIn, zoomOut, zoomReset } from './zoom'

describe('zoom', () => {
  beforeEach(() => {
    setZoom.mockReset()
    setZoom.mockResolvedValue(undefined)
  })

  it('ZOOM_STEPS holds the eight steps from 0.8 to 2', () => {
    expect(ZOOM_STEPS).toEqual([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2])
  })

  it('readZoom returns a stored step', () => {
    localStorage.setItem('luradb.zoom', '1.25')
    expect(readZoom()).toBe(1.25)
  })

  it('readZoom falls back to 1 for a missing, non-numeric or off-step value', () => {
    expect(readZoom()).toBe(1)
    localStorage.setItem('luradb.zoom', 'big')
    expect(readZoom()).toBe(1)
    localStorage.setItem('luradb.zoom', '1.3')
    expect(readZoom()).toBe(1)
  })

  it('applyZoom sets the webview zoom and stores the factor under luradb.zoom', () => {
    applyZoom(1.5)
    expect(setZoom).toHaveBeenCalledWith(1.5)
    expect(localStorage.getItem('luradb.zoom')).toBe('1.5')
  })

  it('zoomIn moves one step up and stays at 2', () => {
    localStorage.setItem('luradb.zoom', '1.5')
    expect(zoomIn()).toBe(1.75)
    expect(zoomIn()).toBe(2)
    expect(zoomIn()).toBe(2)
    expect(setZoom).toHaveBeenLastCalledWith(2)
    expect(localStorage.getItem('luradb.zoom')).toBe('2')
  })

  it('zoomOut moves one step down and stays at 0.8', () => {
    localStorage.setItem('luradb.zoom', '0.9')
    expect(zoomOut()).toBe(0.8)
    expect(zoomOut()).toBe(0.8)
    expect(setZoom).toHaveBeenLastCalledWith(0.8)
    expect(localStorage.getItem('luradb.zoom')).toBe('0.8')
  })

  it('zoomReset returns to 1', () => {
    localStorage.setItem('luradb.zoom', '1.75')
    expect(zoomReset()).toBe(1)
    expect(setZoom).toHaveBeenCalledWith(1)
    expect(localStorage.getItem('luradb.zoom')).toBe('1')
  })
})
