import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ApiClient } from '../api'
import { useSession } from '../app/session'
import { useDomainSummaries } from './domains'

const STORAGE_KEY = 'luradb.selectedDomain'

interface SelectedDomainValue {
  selected: string | null
  select: (name: string) => void
}

const SelectedDomainContext = createContext<SelectedDomainValue | undefined>(undefined)

function readStoredSelection(): string | null {
  return sessionStorage.getItem(STORAGE_KEY)
}

/** App-weite Domänen-Auswahl (Context + sessionStorage). Default fällt auf die alphabetisch erste Domäne, sobald die Liste lädt. */
export function SelectedDomainProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const apiClient: ApiClient | undefined = session.status === 'connected' ? session.apiClient : undefined
  const domains = useDomainSummaries(apiClient)
  const [selected, setSelected] = useState<string | null>(readStoredSelection)

  useEffect(() => {
    if (domains.length === 0) return
    if (selected !== null && domains.some((domain) => domain.name === selected)) return
    setSelected(domains[0]?.name ?? null)
  }, [domains, selected])

  useEffect(() => {
    if (selected === null) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, selected)
  }, [selected])

  function select(name: string): void {
    setSelected(name)
  }

  return <SelectedDomainContext.Provider value={{ selected, select }}>{children}</SelectedDomainContext.Provider>
}

export function useSelectedDomain(): SelectedDomainValue {
  const context = useContext(SelectedDomainContext)
  if (context === undefined) throw new Error('useSelectedDomain must be used within SelectedDomainProvider')
  return context
}
