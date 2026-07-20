import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { ApiClient } from '../api'
import { createJsonDomain, createKvDomain, createRelDomain, JSON_DOMAINS_KEY, KV_DOMAINS_KEY, REL_DOMAINS_KEY } from './domains'
import { runEngineCascade, type Engine } from './engineCascade'

interface CreateDomainFormProps {
  apiClient: ApiClient | undefined
  onClose: () => void
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
const ENGINE_ORDER: Engine[] = ['kv', 'json', 'rel']
const CREATORS: Record<Engine, (apiClient: ApiClient, name: string) => Promise<void>> = {
  kv: createKvDomain,
  json: createJsonDomain,
  rel: createRelDomain,
}

function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('create domain requires an active connection')
  return apiClient
}

/** Inline-Formular "+ create domain" (spec shell/002 §6, shell/003 §1) — Kaskade über alle drei Engines; Vollerfolg schließt automatisch, ein Teilfehler hält das Formular mit Inline-Fehlern offen. */
export function CreateDomainForm({ apiClient, onClose }: CreateDomainFormProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createMutation = useMutation({
    mutationFn: () => runEngineCascade(ENGINE_ORDER, requireApiClient(apiClient), name, CREATORS),
    onSuccess: (failures) => {
      void queryClient.invalidateQueries({ queryKey: KV_DOMAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: JSON_DOMAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: REL_DOMAINS_KEY })
      if (failures.length === 0) onClose()
    },
  })

  const nameValid = name.length > 0 && name.length <= 50 && NAME_PATTERN.test(name)

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!nameValid) return
    createMutation.mutate()
  }

  return (
    <form className="explorer__create-form" onSubmit={handleSubmit}>
      <input
        className="explorer__create-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="domain name"
        maxLength={50}
        pattern="[a-zA-Z0-9_-]+"
        aria-label="domain name"
      />
      <span className="explorer__create-hint mono-path">&quot;domains&quot; is reserved</span>
      {createMutation.data && createMutation.data.length > 0 && (
        <span className="explorer__create-error">{createMutation.data.join(' · ')}</span>
      )}
      <div className="explorer__create-actions">
        <button type="submit" className="explorer__create-submit" disabled={!nameValid || createMutation.isPending}>
          create
        </button>
        <button type="button" onClick={onClose}>
          cancel
        </button>
      </div>
    </form>
  )
}
