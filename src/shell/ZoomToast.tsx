import { useEffect, useState } from 'react'
import type { ZoomCommand } from './useZoom'
import './ZoomToast.css'

const VISIBLE_MS = 1200

export function ZoomToast({ command }: { command: ZoomCommand | null }) {
  const [expired, setExpired] = useState<ZoomCommand | null>(null)

  useEffect(() => {
    if (!command) return
    const timer = setTimeout(() => setExpired(command), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [command])

  if (!command || command === expired) return null
  return <div className="zoom-toast">Zoom {Math.round(command.factor * 100)} %</div>
}
