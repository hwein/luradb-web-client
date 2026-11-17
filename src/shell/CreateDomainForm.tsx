import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ApiError, type ApiClient } from '../api'
import { createDomain, DOMAINS_KEY } from './domains'

interface CreateDomainFormProps {
  apiClient: ApiClient | undefined
  onClose: () => void
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('create domain requires an active connection')
  return apiClient
}

function messageOf(error: Error): string {
  return error instanceof ApiError ? `${error.status} ${error.message}` : error.message
}

/** Inline form "+ create domain" (spec shell/002 §6, shell/003 §1): one POST; success closes it, an error keeps it open with the error inline. */
export function CreateDomainForm({ apiClient, onClose }: CreateDomainFormProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [requireConditionalWrites, setRequireConditionalWrites] = useState(false)

  const createMutation = useMutation({
    mutationFn: () => createDomain(requireApiClient(apiClient), name, requireConditionalWrites),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DOMAINS_KEY })
      onClose()
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
      {createMutation.error && <span className="explorer__create-error">{messageOf(createMutation.error)}</span>}
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
