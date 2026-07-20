import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError, type ApiClient } from '../api'
import type { components } from '../api/schema'

type KvDomain = components['schemas']['DomainResponse']
type JsonDomain = components['schemas']['JsonDomainResponse']
type RelDomain = components['schemas']['RelDomainResponse']

export interface DomainSummary {
  name: string
  engines: {
    kv?: true
    json?: { state: string }
    rel?: { state: string }
  }
}

export const KV_DOMAINS_KEY = ['domains', 'kv'] as const
export const JSON_DOMAINS_KEY = ['domains', 'json'] as const
export const REL_DOMAINS_KEY = ['domains', 'rel'] as const

/** Geteilte Query-Options: Explorer und Screens nutzen denselben Key + dieselbe queryFn — ein Cache-Eintrag. */
export function kvDomainsQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: KV_DOMAINS_KEY,
    queryFn: async (): Promise<KvDomain[]> => {
      if (!apiClient) throw new Error('domain list query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/domains')
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (!response.ok || !data) throw new ApiError(response.status, 'engine unreachable')
      return data
    },
    enabled: apiClient !== undefined,
  })
}

export function jsonDomainsQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: JSON_DOMAINS_KEY,
    queryFn: async (): Promise<JsonDomain[]> => {
      if (!apiClient) throw new Error('domain list query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/json/domains')
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (!response.ok || !data) throw new ApiError(response.status, 'engine unreachable')
      return data
    },
    enabled: apiClient !== undefined,
  })
}

export function relDomainsQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: REL_DOMAINS_KEY,
    queryFn: async (): Promise<RelDomain[]> => {
      if (!apiClient) throw new Error('domain list query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/rel/domains')
      if (response.status === 401) throw new ApiError(401, 'invalid api key')
      if (!response.ok || !data) throw new ApiError(response.status, 'engine unreachable')
      return data
    },
    enabled: apiClient !== undefined,
  })
}

/** Fehlt eine Engine-Liste (Fehler), zählt sie hier als leer — die übrigen Engines bilden die Union trotzdem. */
function mergeDomains(kv: KvDomain[] | undefined, json: JsonDomain[] | undefined, rel: RelDomain[] | undefined): DomainSummary[] {
  const byName = new Map<string, DomainSummary>()

  function entryFor(name: string): DomainSummary {
    const existing = byName.get(name)
    if (existing) return existing
    const created: DomainSummary = { name, engines: {} }
    byName.set(name, created)
    return created
  }

  for (const domain of kv ?? []) entryFor(domain.name).engines.kv = true
  for (const domain of json ?? []) entryFor(domain.name).engines.json = { state: domain.state }
  for (const domain of rel ?? []) entryFor(domain.name).engines.rel = { state: domain.state }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Union der drei Domain-Listen nach Name, alphabetisch (spec shell/002 §1). */
export function useDomainSummaries(apiClient: ApiClient | undefined): DomainSummary[] {
  const kv = useQuery(kvDomainsQueryOptions(apiClient))
  const json = useQuery(jsonDomainsQueryOptions(apiClient))
  const rel = useQuery(relDomainsQueryOptions(apiClient))

  return useMemo(() => mergeDomains(kv.data, json.data, rel.data), [kv.data, json.data, rel.data])
}

/**
 * Für den Explorer-Empty-State (spec shell/003 §3): true, solange irgendeine der drei Listen noch lädt.
 * Ohne Verbindung sind die Queries disabled und bleiben dauerhaft `isPending` — der Hinweis bleibt dadurch unterdrückt.
 * Gleiche Query-Options wie `useDomainSummaries` (cache-geteilt, keine Zusatz-Requests).
 */
export function useDomainsPending(apiClient: ApiClient | undefined): boolean {
  const kv = useQuery(kvDomainsQueryOptions(apiClient))
  const json = useQuery(jsonDomainsQueryOptions(apiClient))
  const rel = useQuery(relDomainsQueryOptions(apiClient))

  return kv.isPending || json.isPending || rel.isPending
}

function messageForDomainCreateError(status: number): string {
  return status === 409 ? 'domain already exists' : `create domain failed (HTTP ${status})`
}

// Drei getrennte Funktionen statt einer generischen (dynamische Pfade lassen sich mit openapi-fetch's
// literalen Pfad-Overloads nicht sauber typisieren) — admin/001 kann sie direkt wiederverwenden.
export async function createKvDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.POST('/store-api/domains', { body: { name } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainCreateError(response.status))
}

export async function createJsonDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.POST('/store-api/json/domains', { body: { name } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainCreateError(response.status))
}

export async function createRelDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.POST('/store-api/rel/domains', { body: { name } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainCreateError(response.status))
}

function messageForDomainDeleteError(status: number): string {
  if (status === 404) return 'domain not found'
  if (status === 410) return 'already deleting'
  return 'delete failed'
}

// Gleiches Muster wie bei create* (admin/001, Löschkaskade): eine Funktion je Engine statt generisch.
export async function deleteKvDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/domains/{name}', { params: { path: { name } } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainDeleteError(response.status))
}

export async function deleteJsonDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/json/domains/{name}', { params: { path: { name } } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainDeleteError(response.status))
}

export async function deleteRelDomain(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/rel/domains/{name}', { params: { path: { name } } })
  if (!response.ok) throw new ApiError(response.status, messageForDomainDeleteError(response.status))
}
