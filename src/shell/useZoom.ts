import { useEffect, useState } from 'react'
import { getEnvironment } from '../app/environment'
import { applyZoom, readZoom, zoomIn, zoomOut, zoomReset } from './zoom'

const WHEEL_STEP_MS = 150

export interface ZoomCommand {
  factor: number
  step: number
}

function commandFor(event: KeyboardEvent): (() => number) | null {
  const { key, code } = event
  if (key === '=' || key === '+' || code === 'NumpadAdd') return zoomIn
  if (key === '-' || code === 'NumpadSubtract') return zoomOut
  if (key === '0' || code === 'Numpad0') return zoomReset
  return null
}

export function useZoom(): ZoomCommand | null {
  const [command, setCommand] = useState<ZoomCommand | null>(null)

  useEffect(() => {
    if (getEnvironment() !== 'desktop') return
    applyZoom(readZoom())

    const hasModifier = (event: KeyboardEvent | WheelEvent) =>
      (event.ctrlKey || event.metaKey) && !event.altKey
    const execute = (run: () => number) => {
      const factor = run()
      setCommand((prev) => ({ factor, step: (prev?.step ?? 0) + 1 }))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!hasModifier(event)) return
      const run = commandFor(event)
      if (!run) return
      event.preventDefault()
      execute(run)
    }
    // A touchpad gesture fires ctrl-wheel events densely: at most one step per 150 ms in one direction.
    let lastWheel = { direction: 0, at: Number.NEGATIVE_INFINITY }
    const onWheel = (event: WheelEvent) => {
      if (!hasModifier(event)) return
      event.preventDefault()
      if (event.deltaY === 0) return
      const direction = Math.sign(event.deltaY)
      const now = Date.now()
      if (direction === lastWheel.direction && now - lastWheel.at < WHEEL_STEP_MS) return
      lastWheel = { direction, at: now }
      execute(direction < 0 ? zoomIn : zoomOut)
    }
    // Capture phase: the shortcuts must also work while the editor has focus
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  return command
}
