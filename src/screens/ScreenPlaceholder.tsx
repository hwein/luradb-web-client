import type { ReactNode } from 'react'
import './ScreenPlaceholder.css'

interface ScreenPlaceholderProps {
  title: string
  children?: ReactNode
}

/** Placeholder until the screen is implemented. */
export function ScreenPlaceholder({ title, children }: ScreenPlaceholderProps) {
  return (
    <div className="screen-placeholder">
      <h1 className="screen-placeholder__title">{title}</h1>
      {children}
    </div>
  )
}
