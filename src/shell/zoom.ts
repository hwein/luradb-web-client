import { getCurrentWebview } from '@tauri-apps/api/webview'

export const ZOOM_STEPS: readonly number[] = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]

const STORAGE_KEY = 'luradb.zoom'
const DEFAULT_ZOOM = 1.0

export function readZoom(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY))
  return ZOOM_STEPS.includes(stored) ? stored : DEFAULT_ZOOM
}

export function applyZoom(factor: number): void {
  getCurrentWebview()
    .setZoom(factor)
    .catch(() => {})
  localStorage.setItem(STORAGE_KEY, String(factor))
}

function moveBy(delta: number): number {
  const index = ZOOM_STEPS.indexOf(readZoom())
  const next = Math.min(Math.max(index + delta, 0), ZOOM_STEPS.length - 1)
  const factor = ZOOM_STEPS[next] ?? DEFAULT_ZOOM
  applyZoom(factor)
  return factor
}

export function zoomIn(): number {
  return moveBy(1)
}

export function zoomOut(): number {
  return moveBy(-1)
}

export function zoomReset(): number {
  applyZoom(DEFAULT_ZOOM)
  return DEFAULT_ZOOM
}
