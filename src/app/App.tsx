import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router'
import { AppShell, TitleBar, useDesktopGuards, useZoom, ZoomToast } from '../shell'
import './App.css'
import { ConnectionGate } from './ConnectionGate'
import { createAppQueryClient } from './queryClient'
import { useSession } from './session'

// Legacy key of the removed configuration page; it held plaintext TOML including the api_key. Purged on start.
const LEGACY_TOML_STORAGE_KEY = 'luradb.toml'

// No autoconnect: every app start begins at the gate and connecting is a deliberate click.
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
      // best-effort (storage disabled) — cleanup is optional.
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
