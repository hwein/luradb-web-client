import { ApiError, messageFromBody, type ApiClient } from '../../api'
import type { UserPermission } from './users'

const CELL_VALUES = ['none', 'read', 'write', 'ddl'] as const
export type CellValue = (typeof CELL_VALUES)[number]

export function isCellValue(level: string): level is CellValue {
  return CELL_VALUES.some((value) => value === level)
}

/** openapi-fetch has already read the error body: plaintext ⇒ string, JSON ⇒ object, empty ⇒ undefined. */
function permissionError(status: number, error: unknown): ApiError {
  const text = typeof error === 'string' && error.trim() !== '' ? error.trim() : messageFromBody(error)
  return new ApiError(status, text ?? `permission update failed (HTTP ${status})`)
}

/** Grants the level on the whole domain, or on one engine of it when `engine` is given. */
export async function setPermission(
  apiClient: ApiClient,
  userName: string,
  domainName: string,
  access: 'read' | 'write',
  engine?: string,
): Promise<void> {
  const { error, response } = await apiClient.api.POST('/store-api/auth/users/{name}/permissions', {
    params: { path: { name: userName } },
    body: engine === undefined ? { domain: domainName, access } : { domain: domainName, engine, access },
  })
  if (!response.ok) throw permissionError(response.status, error)
}

/** Revokes every permission of the user on the domain, or only the one on `engine` when given. */
export async function removePermission(apiClient: ApiClient, userName: string, domainName: string, engine?: string): Promise<void> {
  const { error, response } = await apiClient.api.DELETE('/store-api/auth/users/{name}/permissions/{domain}', {
    params: { path: { name: userName, domain: domainName }, query: engine === undefined ? undefined : { engine } },
  })
  if (!response.ok) throw permissionError(response.status, error)
}

interface DomainLevels {
  /** Level of the grant on the whole domain (entry without `engine`). */
  whole: string | undefined
  /** Level per engine; the server keeps either `whole` or these. */
  parts: Partial<Record<string, string>>
}

/** The stored levels of one user on one domain; levels outside `CellValue` pass through verbatim. */
export function levelsOn(permissions: UserPermission[], domainName: string): DomainLevels {
  const levels: DomainLevels = { whole: undefined, parts: {} }
  for (const entry of permissions) {
    if (entry.domain !== domainName) continue
    if (entry.engine === undefined || entry.engine === null) levels.whole = entry.access
    else levels.parts[entry.engine] = entry.access
  }
  return levels
}

type CellAction = (apiClient: ApiClient, userName: string, domainName: string, engine?: string) => Promise<void>

/** Chip cycle — → read → read+write → —; `ddl` and unknown levels are revoked. */
export function cellActionFor(current: string): CellAction {
  if (current === 'none') return (c, u, d, e) => setPermission(c, u, d, 'read', e)
  if (current === 'read') return (c, u, d, e) => setPermission(c, u, d, 'write', e)
  return removePermission
}
