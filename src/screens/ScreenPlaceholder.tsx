import type { ReactNode } from 'react'
import './ScreenPlaceholder.css'

interface ScreenPlaceholderProps {
  title: string
  children?: ReactNode
}

/** Platzhalter, bis die jeweilige Bereichs-Spec den Screen füllt. */
export function ScreenPlaceholder({ title, children }: ScreenPlaceholderProps) {
  return (
    <div className="screen-placeholder">
      <h1 className="screen-placeholder__title">{title}</h1>
      {children}
    </div>
  )
}
