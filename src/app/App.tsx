import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router'
import { AppShell } from '../shell'
import { ConnectionGate } from './ConnectionGate'
import { createAppQueryClient } from './queryClient'
import { useSession } from './session'

// Alt-Key der entfernten Config-Edit-Persistenz (spec config/003 §5) — enthielt den TOML-Klartext samt api_key.
// Purge beim App-Start, nicht erst auf /config: der Bestand muss auch ohne Config-Besuch verschwinden.
const LEGACY_TOML_STORAGE_KEY = 'luradb.toml'

// Kein Autoconnect (Autor-Vorgabe 2026-07-17): App-Neustart heißt neue Sitzung — Start immer im Gate,
// Verbinden ist ein bewusster Klick (mit gemerktem Key genau einer).
function AppContent() {
  const session = useSession()
  return session.status === 'connected' ? <AppShell /> : <ConnectionGate />
}

export function App() {
  const [queryClient] = useState(createAppQueryClient)

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
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
