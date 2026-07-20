import { ApiError, type ApiClient } from '../../api'
import type { DomainSummary } from '../../shell/domains'
import type { Engine } from '../../shell/engineCascade'

export type PermissionLevel = 'read' | 'write'
export type CellValue = 'unknown' | 'none' | PermissionLevel

const ENGINE_PRIORITY: Engine[] = ['kv', 'json', 'rel']

/**
 * Eine Matrix-Spalte = ein Domain-Name, aber `SetPermissionRequest` verlangt einen `store_type`
 * (Permissions leben pro Engine). kv zuerst: der Server prüft dort wirklich, ob die Domain
 * existiert — json/rel nehmen jeden Namen ungeprüft an (live verifiziert, admin/002-Bericht).
 */
export function primaryEngineFor(domain: DomainSummary): Engine | undefined {
  return ENGINE_PRIORITY.find((engine) => domain.engines[engine] !== undefined)
}

function messageForPermissionError(status: number): string {
  if (status === 404) return 'user or domain not found'
  if (status === 400) return 'invalid access or domain'
  return `permission update failed (HTTP ${status})`
}

export async function setPermission(
  apiClient: ApiClient,
  userName: string,
  domainName: string,
  storeType: Engine,
  access: PermissionLevel,
): Promise<void> {
  const { response } = await apiClient.api.POST('/store-api/auth/users/{name}/permissions', {
    params: { path: { name: userName } },
    body: { domain: domainName, access, store_type: storeType },
  })
  if (!response.ok) throw new ApiError(response.status, messageForPermissionError(response.status))
}

export async function removePermission(apiClient: ApiClient, userName: string, domainName: string, storeType: Engine): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/auth/users/{name}/permissions/{domain}', {
    params: { path: { name: userName, domain: domainName }, query: { store_type: storeType } },
  })
  if (!response.ok) throw new ApiError(response.status, response.status === 404 ? 'permission not found' : messageForPermissionError(response.status))
}

interface CellAction {
  next: CellValue
  perform: (apiClient: ApiClient, userName: string, domainName: string, storeType: Engine) => Promise<void>
}

/** Zell-Zyklus (spec admin/002 §2): ?/— → read → read+write → — → read … */
export function cellActionFor(current: CellValue): CellAction {
  if (current === 'read') return { next: 'write', perform: (c, u, d, s) => setPermission(c, u, d, s, 'write') }
  if (current === 'write') return { next: 'none', perform: (c, u, d, s) => removePermission(c, u, d, s) }
  return { next: 'read', perform: (c, u, d, s) => setPermission(c, u, d, s, 'read') }
}
