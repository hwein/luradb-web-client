import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router'
import { AppShell, TitleBar, useDesktopGuards, useZoom, ZoomToast } from '../shell'
import './App.css'
import { ConnectionGate } from './ConnectionGate'
import { createAppQueryClient } from './queryClient'
import { useSession } from './session'

// Alt-Key der entfernten Configuration-Seite (spec config/003 §5, Seite selbst entfernt in config/005) —
// enthielt den TOML-Klartext samt api_key. Purge beim App-Start, unabhängig vom Screen-Rückbau.
const LEGACY_TOML_STORAGE_KEY = 'luradb.toml'

// Kein Autoconnect (Autor-Vorgabe 2026-07-17): App-Neustart heißt neue Sitzung — Start immer im Gate,
// Verbinden ist ein bewusster Klick (mit gemerktem Key genau einer).
function AppContent() {
  const session = useSession()
  return session.status === 'connected' ? <AppShell /> : <ConnectionGate />
}

export function App() {
  const [queryClient] = useState(createAppQueryClient)
  const zoomCommand = useZoom()
  useDesktopGuards()

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_TOML_STORAGE_KEY)
    } catch {
      // best-effort (Storage deaktiviert) — Cleanup ist optional.
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="app-frame">
          <TitleBar />
          <div className="app-frame__content">
            <AppContent />
          </div>
        </div>
      </BrowserRouter>
      <ZoomToast command={zoomCommand} />
    </QueryClientProvider>
  )
}
