import { useEffect } from 'react'
import { getEnvironment } from '../app/environment'

const NATIVE_MENU_TARGETS = 'input, textarea, [contenteditable], .cm-editor'

function isBlockedKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  const command = (event.ctrlKey || event.metaKey) && !event.altKey
  if (key === 'f5') return true
  if (command && (key === 'r' || key === 'p' || key === 'f')) return true
  if (import.meta.env.DEV) return false
  return key === 'f12' || (command && event.shiftKey && key === 'i')
}

export function useDesktopGuards(): void {
  useEffect(() => {
    if (getEnvironment() !== 'desktop') return

    const onContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(NATIVE_MENU_TARGETS)) return
      event.preventDefault()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isBlockedKey(event)) event.preventDefault()
    }
    document.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
