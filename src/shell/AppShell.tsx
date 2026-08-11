import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import { AdminScreen } from '../screens/admin'
import { ConfigScreen } from '../screens/config'
import { DataScreen } from '../screens/data'
import { DocsScreen } from '../screens/docs'
import { EnginesScreen } from '../screens/engines'
import { RestScreen } from '../screens/rest'
import { SqlScreen } from '../screens/sql'
import './AppShell.css'
import { CommandPalette } from './CommandPalette'
import { Explorer } from './Explorer'
import { Rail } from './Rail'
import { SelectedDomainProvider } from './SelectedDomainContext'
import { Statusbar } from './Statusbar'

/** F1 ist global für die Docs-Suche reserviert. Hook-Punkt für sql/001: CodeMirror fängt F1 im Editor-Fokus selbst ab. */
function useDocsShortcut(): void {
  const navigate = useNavigate()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'F1') return
      event.preventDefault()
      void navigate('/docs', { state: { focusSearch: true } })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])
}

/** Ctrl+K/Cmd+K für die Command-Palette (spec shell/008 §1) — Capture-Phase, damit sie auch bei CodeMirror-Editor-Fokus greift. */
function useCommandPalette(): { open: boolean; close: () => void } {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== 'k' || (!event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      setOpen((was) => !was)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return { open, close: () => setOpen(false) }
}

export function AppShell() {
  useDocsShortcut()
  const commandPalette = useCommandPalette()

  return (
    <SelectedDomainProvider>
      <div className="app-shell">
        <Rail />
        <div className="app-shell__explorer">
          <Explorer />
        </div>
        <div className="app-shell__main">
          <div className="app-shell__content">
            <Routes>
              <Route path="/" element={<Navigate to="/sql" replace />} />
              <Route path="/sql" element={<SqlScreen />} />
              <Route path="/data" element={<DataScreen />} />
              <Route path="/rest" element={<RestScreen />} />
              <Route path="/engines" element={<EnginesScreen />} />
              <Route path="/admin/*" element={<AdminScreen />} />
              <Route path="/config" element={<ConfigScreen />} />
              <Route path="/docs" element={<DocsScreen />} />
            </Routes>
          </div>
          <Statusbar />
        </div>
        {commandPalette.open && <CommandPalette onClose={commandPalette.close} />}
      </div>
    </SelectedDomainProvider>
  )
}
