import { ApiError, type ApiClient } from '../../api'

export type PermissionLevel = 'read' | 'write'
export type CellValue = 'unknown' | 'none' | PermissionLevel

function messageForPermissionError(status: number): string {
  if (status === 404) return 'user or domain not found'
  if (status === 400) return 'invalid access or domain'
  return `permission update failed (HTTP ${status})`
}

/** Grants the level on the whole domain (no engine). */
export async function setPermission(apiClient: ApiClient, userName: string, domainName: string, access: PermissionLevel): Promise<void> {
  const { response } = await apiClient.api.POST('/store-api/auth/users/{name}/permissions', {
    params: { path: { name: userName } },
    body: { domain: domainName, access },
  })
  if (!response.ok) throw new ApiError(response.status, messageForPermissionError(response.status))
}

/** Revokes every permission of the user on the domain (no engine). */
export async function removePermission(apiClient: ApiClient, userName: string, domainName: string): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/auth/users/{name}/permissions/{domain}', {
    params: { path: { name: userName, domain: domainName } },
  })
  if (!response.ok) throw new ApiError(response.status, response.status === 404 ? 'permission not found' : messageForPermissionError(response.status))
}

interface CellAction {
  next: CellValue
  perform: (apiClient: ApiClient, userName: string, domainName: string) => Promise<void>
}

/** Zell-Zyklus (spec admin/002 §2): ?/— → read → read+write → — → read … */
export function cellActionFor(current: CellValue): CellAction {
  if (current === 'read') return { next: 'write', perform: (c, u, d) => setPermission(c, u, d, 'write') }
  if (current === 'write') return { next: 'none', perform: removePermission }
  return { next: 'read', perform: (c, u, d) => setPermission(c, u, d, 'read') }
}
