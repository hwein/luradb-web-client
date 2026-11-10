import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'
import { pollSilentRecord } from './pollSilentRecord'

type DomainResponse = components['schemas']['DomainResponse']

export interface DomainSummary {
  name: string
  /** Engines whose single writes need a precondition (require_conditional_writes). */
  conditionalWrites: Array<'kv' | 'json'>
}

/** Tooltip naming the engines that require conditional writes; undefined when none does. */
export function conditionalWritesTitle(domain: DomainSummary): string | undefined {
  return domain.conditionalWrites.length ? `require_conditional_writes: ${domain.conditionalWrites.join(', ')}` : undefined
}

export const DOMAINS_KEY = ['domains'] as const

/** Geteilte Query-Options: Explorer und Screens nutzen denselben Key + dieselbe queryFn — ein Cache-Eintrag. */
export function domainsQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: DOMAINS_KEY,
    queryFn: async (context): Promise<DomainResponse[]> => {
      if (!apiClient) throw new Error('domain list query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/domains', { silentRecord: pollSilentRecord(context) })
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (!response.ok || !data) throw new ApiError(response.status, 'domain list failed')
      return data
    },
    enabled: apiClient !== undefined,
    refetchInterval: 30_000,
  })
}

function conditionalWritesOf(domain: DomainResponse): Array<'kv' | 'json'> {
  const { kv, json } = domain.require_conditional_writes
  return [...(kv ? ['kv' as const] : []), ...(json ? ['json' as const] : [])]
}

function toSummaries(domains: DomainResponse[] | undefined): DomainSummary[] {
  return (domains ?? [])
    .map((domain) => ({ name: domain.name, conditionalWrites: conditionalWritesOf(domain) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The domain list, sorted alphabetically; empty while it loads or after it failed. */
export function useDomainSummaries(apiClient: ApiClient | undefined): DomainSummary[] {
  const { data } = useQuery(domainsQueryOptions(apiClient))
  return useMemo(() => toSummaries(data), [data])
}

/**
 * For the explorer empty state (spec shell/003 §3): true while the list is loading.
 * Without a connection the query is disabled and stays `isPending`, which keeps the hint suppressed.
 */
export function useDomainsPending(apiClient: ApiClient | undefined): boolean {
  return useQuery(domainsQueryOptions(apiClient)).isPending
}

function messageForDomainCreateError(status: number): string {
  return status === 409 ? 'domain already exists' : `create domain failed (HTTP ${status})`
}

export async function createDomain(apiClient: ApiClient, name: string, requireConditionalWrites = false): Promise<void> {
  const { response } = await apiClient.api.POST('/store-api/domains', {
    body: requireConditionalWrites ? { name, require_conditional_writes: { kv: true, json: true } } : { name },
  })
  if (!response.ok) throw new ApiError(response.status, messageForDomainCreateError(response.status))
}

function messageForDomainDeleteError(status: number): string {
  if (status === 404) return 'domain not found'
  if (status === 410) return 'already deleting'
  return 'delete failed'
}

export async function deleteDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/domains/{name}', { params: { path: { name } } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainDeleteError(response.status))
}
