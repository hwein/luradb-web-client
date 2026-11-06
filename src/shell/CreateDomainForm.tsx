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
function creatorsFor(requireConditionalWrites: boolean): Record<Engine, (apiClient: ApiClient, name: string) => Promise<void>> {
  return {
    kv: (apiClient, name) => createKvDomain(apiClient, name, requireConditionalWrites),
    json: (apiClient, name) => createJsonDomain(apiClient, name, requireConditionalWrites),
    rel: createRelDomain,
  }
}

function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('create domain requires an active connection')
  return apiClient
}

/** Inline-Formular "+ create domain" (spec shell/002 §6, shell/003 §1) — Kaskade über alle drei Engines; Vollerfolg schließt automatisch, ein Teilfehler hält das Formular mit Inline-Fehlern offen. */
export function CreateDomainForm({ apiClient, onClose }: CreateDomainFormProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [requireConditionalWrites, setRequireConditionalWrites] = useState(false)

  const createMutation = useMutation({
    mutationFn: () => runEngineCascade(ENGINE_ORDER, requireApiClient(apiClient), name, creatorsFor(requireConditionalWrites)),
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
        pattern="[a-zA-Z0-9_\-]+"
        aria-label="domain name"
      />
      <label className="explorer__create-check">
        <input
          type="checkbox"
          checked={requireConditionalWrites}
          onChange={(event) => setRequireConditionalWrites(event.target.checked)}
        />
        require conditional writes
      </label>
      <span className="explorer__create-hint mono-path">writes need If-Match / If-None-Match (428 otherwise)</span>
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
