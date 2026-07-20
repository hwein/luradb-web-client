import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter } from 'react-router'
import { AppShell } from '../shell'
import { ConnectionGate } from './ConnectionGate'
import { createAppQueryClient } from './queryClient'
import { useSession } from './session'

// Kein Autoconnect (Autor-Vorgabe 2026-07-17): App-Neustart heißt neue Sitzung — Start immer im Gate,
// Verbinden ist ein bewusster Klick (mit gemerktem Key genau einer).
function AppContent() {
  const session = useSession()
  return session.status === 'connected' ? <AppShell /> : <ConnectionGate />
}

export function App() {
  const [queryClient] = useState(createAppQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
