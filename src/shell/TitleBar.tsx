import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState, type ReactNode } from 'react'
import { getEnvironment } from '../app/environment'
import { LogoMark } from '../brand/LogoMark'
import './TitleBar.css'

function isMacOS(): boolean {
  return /mac/i.test(navigator.platform || navigator.userAgent)
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {children}
    </svg>
  )
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let active = true
    const sync = () => {
      void appWindow.isMaximized().then((value) => {
        if (active) setMaximized(value)
      })
    }
    sync()
    const unlisten = appWindow.onResized(sync)
    return () => {
      active = false
      void unlisten.then((stop) => stop())
    }
  }, [])

  return (
    <div className="titlebar__controls">
      <button
        type="button"
        className="titlebar__control"
        tabIndex={-1}
        aria-label="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Icon>
          <path d="M0 5.5h10" />
        </Icon>
      </button>
      <button
        type="button"
        className="titlebar__control"
        tabIndex={-1}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        <Icon>
          {maximized ? (
            <>
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 2.5v-2h7v7h-2" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" />
          )}
        </Icon>
      </button>
      <button
        type="button"
        className="titlebar__control titlebar__control--close"
        tabIndex={-1}
        aria-label="Close"
        onClick={() => void getCurrentWindow().close()}
      >
        <Icon>
          <path d="M0 0l10 10M10 0L0 10" />
        </Icon>
      </button>
    </div>
  )
}

export function TitleBar() {
  if (getEnvironment() !== 'desktop') return null
  const macos = isMacOS()

  return (
    <div className={macos ? 'titlebar titlebar--macos' : 'titlebar'} data-tauri-drag-region="deep">
      <LogoMark size={18} />
      <span className="titlebar__name">LuraDB Client</span>
      {!macos && <WindowControls />}
    </div>
  )
}
