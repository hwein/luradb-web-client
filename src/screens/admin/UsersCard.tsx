import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ApiError, type ApiClient } from '../../api'
import { DOMAINS_KEY, domainsQueryOptions, useDomainSummaries, type DomainSummary } from '../../shell/domains'
import { requireApiClient } from './DomainsCard'
import { cellActionFor, isCellValue, levelsOn, removePermission, type CellValue } from './permissions'
import {
  createUser,
  deleteUser,
  rotateUserKey,
  USERS_KEY,
  usersQueryOptions,
  type CreateUserResponse,
  type RotateKeyResponse,
  type UserListItem,
  type UserPermission,
} from './users'

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
const ENGINES = ['kv', 'json', 'rel'] as const
const CELL_LABEL: Partial<Record<CellValue, string>> = { none: '—', write: 'read+write' }
const PER_PART = 'per part'
const PER_PART_TITLE = 'set per part — clear the part permissions to grant the whole domain'
const WHOLE_DOMAIN = 'whole domain'
const OFFGRID_LABEL = 'granted outside the domain list:'
const OFFGRID_ADMIN_LABEL = 'stored grants (no effect for an admin):'
const OFFGRID_TITLE = 'the domain is not in the domain list — granted ahead of its creation'

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : 'request failed'
}

/** A permission error is shown with its text only, without a status prefix. */
function permissionMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/** A 404 on a permission call means the user list or the domain list is stale. */
function reloadOn404(queryClient: QueryClient, error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 404) return
  void queryClient.invalidateQueries({ queryKey: USERS_KEY })
  void queryClient.invalidateQueries({ queryKey: DOMAINS_KEY })
}

/** Entries no chip shows: every entry of an admin, a domain outside the list, an engine outside kv/json/rel. */
function offGridOf(user: UserListItem, isAdmin: boolean, domains: DomainSummary[]): UserPermission[] {
  const permissions = user.permissions ?? []
  if (isAdmin) return permissions
  return permissions.filter(
    (entry) =>
      !domains.some((domain) => domain.name === entry.domain) ||
      (entry.engine !== undefined && entry.engine !== null && !ENGINES.some((engine) => engine === entry.engine)),
  )
}

function initials(name: string): string {
  return name.slice(0, 2).toLowerCase()
}

function labelOf(level: string): string {
  return (isCellValue(level) ? CELL_LABEL[level] : undefined) ?? level
}

/** The server value never becomes a class name: `ddl`, unknown levels and `per part` share `--other`. */
function modifierOf(level: string): string {
  return isCellValue(level) && level !== 'ddl' ? level : 'other'
}

/** Key nur bis Blur/Unmount im State (spec admin/002 §3/§5) — nie Storage, nie Log. */
function RevealKeyRow({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    function handleBlur(): void {
      onDismissRef.current()
    }
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [])

  function handleCopy(): void {
    void navigator.clipboard?.writeText(apiKey)
    setCopied(true)
  }

  return (
    <div className="admin-users__reveal">
      <span className="admin-users__reveal-key">{apiKey}</span>
      <button type="button" className="admin-users__reveal-copy" onClick={handleCopy}>
        {copied ? 'copied' : 'copy'}
      </button>
      <span className="admin-users__reveal-note">shown once — store it now</span>
    </div>
  )
}

interface PermissionChipProps {
  apiClient: ApiClient | undefined
  userName: string
  domainName: string
  engine?: (typeof ENGINES)[number]
  level: string
  inherited?: boolean
}

/** One chip: a click sends one POST or DELETE, the new value comes from the reloaded user list. */
function PermissionChip({ apiClient, userName, domainName, engine, level, inherited = false }: PermissionChipProps) {
  const queryClient = useQueryClient()
  const label = engine === undefined ? `${userName} · ${domainName}` : `${userName} · ${domainName} · ${engine}`
  const perPart = level === PER_PART

  const mutation = useMutation<void, unknown, void>({
    mutationFn: () => cellActionFor(level)(requireApiClient(apiClient), userName, domainName, engine),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
    onError: (error) => reloadOn404(queryClient, error),
  })

  return (
    <>
      <button
        type="button"
        className={`admin-users__cell admin-users__cell--${modifierOf(level)}${inherited ? ' admin-users__cell--inherited' : ''}`}
        onClick={() => mutation.mutate()}
        disabled={perPart || mutation.isPending}
        aria-label={label}
        title={perPart ? PER_PART_TITLE : label}
      >
        {engine !== undefined && <span className={`admin-users__dot admin-users__dot--${engine}`} />}
        {perPart ? PER_PART : labelOf(level)}
      </button>
      {mutation.isError && !perPart && <span className="admin-users__cell-error">{permissionMessageOf(mutation.error)}</span>}
    </>
  )
}

/** Entries without a chip under the user row, each revocable with one DELETE. */
function OffGridRow({ apiClient, user, isAdmin, entries }: { apiClient: ApiClient | undefined; user: UserListItem; isAdmin: boolean; entries: UserPermission[] }) {
  const queryClient = useQueryClient()

  const mutation = useMutation<void, unknown, UserPermission>({
    mutationFn: (entry) => removePermission(requireApiClient(apiClient), user.name, entry.domain, entry.engine ?? undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
    onError: (error) => reloadOn404(queryClient, error),
  })

  return (
    <div className="admin-users__offgrid" title={isAdmin ? undefined : OFFGRID_TITLE}>
      <span className="admin-users__offgrid-label">{isAdmin ? OFFGRID_ADMIN_LABEL : OFFGRID_LABEL}</span>
      {entries.map((entry) => {
        const scope = entry.engine ?? WHOLE_DOMAIN
        return (
          <span key={`${entry.domain} · ${scope}`} className="admin-users__offgrid-item">
            {`${entry.domain} · ${scope} · ${entry.access}`}
            <button
              type="button"
              className="admin-users__offgrid-revoke"
              aria-label={`revoke ${entry.domain} · ${scope} for ${user.name}`}
              onClick={() => mutation.mutate(entry)}
              disabled={mutation.isPending}
            >
              ×
            </button>
          </span>
        )
      })}
      {mutation.isError && <div className="admin-users__error">{permissionMessageOf(mutation.error)}</div>}
    </div>
  )
}

/** The chips of one domain column: top chip for the whole domain, below one per engine. */
function PermissionCell({ apiClient, user, domainName }: { apiClient: ApiClient | undefined; user: UserListItem; domainName: string }) {
  const { whole, parts } = levelsOn(user.permissions ?? [], domainName)
  const hasParts = ENGINES.some((engine) => parts[engine] !== undefined)
  const wholeLevel = whole ?? (hasParts ? PER_PART : 'none')

  return (
    <span className="admin-users__col-domain">
      <PermissionChip key={wholeLevel} apiClient={apiClient} userName={user.name} domainName={domainName} level={wholeLevel} />
      {ENGINES.map((engine) => {
        const own = parts[engine]
        const level = own ?? whole ?? 'none'
        return (
          <PermissionChip
            key={`${engine}-${level}`}
            apiClient={apiClient}
            userName={user.name}
            domainName={domainName}
            engine={engine}
            level={level}
            inherited={own === undefined && whole !== undefined}
          />
        )
      })}
    </span>
  )
}

type PendingAction = 'rotate' | 'delete' | undefined

interface UserRowProps {
  apiClient: ApiClient | undefined
  user: UserListItem
  domains: DomainSummary[]
  domainsLoaded: boolean
}

/** One user row: avatar, admin badge or permission chips, rotate/delete, and the off-grid row for entries without a chip. */
function UserRow({ apiClient, user, domains, domainsLoaded }: UserRowProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<PendingAction>(undefined)
  const [revealedKey, setRevealedKey] = useState<string | undefined>(undefined)
  const isAdmin = user.role === 'Admin'
  // Without a loaded domain list every grant of a regular user would look off-grid.
  const offGrid = isAdmin || domainsLoaded ? offGridOf(user, isAdmin, domains) : []

  const rotateMutation = useMutation<RotateKeyResponse, unknown, void>({
    mutationFn: () => rotateUserKey(requireApiClient(apiClient), user.name),
    onSuccess: (result) => {
      setRevealedKey(result.api_key)
      setPending(undefined)
    },
  })

  const deleteMutation = useMutation<void, unknown, void>({
    mutationFn: () => deleteUser(requireApiClient(apiClient), user.name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })

  return (
    <div className="admin-users__item">
      <div className="admin-users__row">
        <span className="admin-users__col-user" title={user.name}>
          <span className="admin-users__avatar">{initials(user.name)}</span>
          {user.name}
          {isAdmin && <span className="admin-users__badge-admin">admin</span>}
        </span>
        {domains.map((domain) =>
          isAdmin ? (
            <span key={domain.name} className="admin-users__col-domain admin-users__cell--all">
              all
            </span>
          ) : (
            <PermissionCell key={domain.name} apiClient={apiClient} user={user} domainName={domain.name} />
          ),
        )}
        <span className="admin-users__col-actions">
          <button type="button" className="admin-users__action" onClick={() => setPending('rotate')}>
            rotate key
          </button>
          <button type="button" className="admin-users__action-trash" title="delete user" onClick={() => setPending('delete')}>
            🗑
          </button>
        </span>
      </div>
      {offGrid.length > 0 && <OffGridRow apiClient={apiClient} user={user} isAdmin={isAdmin} entries={offGrid} />}
      {pending === 'rotate' && (
        <div className="admin-users__confirm">
          rotate key for &quot;{user.name}&quot;? the old key stops working immediately.{' '}
          <button
            type="button"
            className="admin-users__confirm-action"
            onClick={() => rotateMutation.mutate()}
            disabled={rotateMutation.isPending}
          >
            confirm
          </button>{' '}
          ·{' '}
          <button type="button" className="admin-users__confirm-cancel" onClick={() => setPending(undefined)}>
            cancel
          </button>
          {rotateMutation.isError && <div className="admin-users__error">{messageOf(rotateMutation.error)}</div>}
        </div>
      )}
      {pending === 'delete' && (
        <div className="admin-users__confirm">
          delete user &quot;{user.name}&quot;?{' '}
          <button
            type="button"
            className="admin-users__confirm-action"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            confirm
          </button>{' '}
          ·{' '}
          <button type="button" className="admin-users__confirm-cancel" onClick={() => setPending(undefined)}>
            cancel
          </button>
          {deleteMutation.isError && <div className="admin-users__error">{messageOf(deleteMutation.error)}</div>}
        </div>
      )}
      {revealedKey && <RevealKeyRow apiKey={revealedKey} onDismiss={() => setRevealedKey(undefined)} />}
    </div>
  )
}

/** Zeile unten "new user" + Create (spec admin/002 §4); Response-Key einmalig wie bei rotate. */
function CreateUserRow({ apiClient }: { apiClient: ApiClient | undefined }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [revealedKey, setRevealedKey] = useState<string | undefined>(undefined)
  const nameValid = name.length > 0 && name.length <= 50 && NAME_PATTERN.test(name)

  const createMutation = useMutation<CreateUserResponse, unknown, void>({
    mutationFn: () => createUser(requireApiClient(apiClient), name),
    onSuccess: (result) => {
      setRevealedKey(result.api_key)
      setName('')
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!nameValid) return
    createMutation.mutate()
  }

  return (
    <div className="admin-users__item">
      <form className="admin-users__create" onSubmit={handleSubmit}>
        <input
          className="admin-users__create-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="new user (max 50 chars, [a-zA-Z0-9_-])"
          maxLength={50}
          aria-label="new user"
        />
        <button type="submit" className="admin-users__create-submit" disabled={!nameValid || createMutation.isPending}>
          Create
        </button>
      </form>
      {createMutation.isError && <div className="admin-users__error">{messageOf(createMutation.error)}</div>}
      {revealedKey && <RevealKeyRow apiKey={revealedKey} onDismiss={() => setRevealedKey(undefined)} />}
    </div>
  )
}

/** USERS & PER-DOMAIN PERMISSIONS-Karte (spec admin/002): Matrix + rotate/delete + Anlage. */
export function UsersCard({ apiClient }: { apiClient: ApiClient | undefined }) {
  const domains = useDomainSummaries(apiClient)
  const domainsLoaded = useQuery(domainsQueryOptions(apiClient)).data !== undefined
  const usersQuery = useQuery(usersQueryOptions(apiClient))
  const users = usersQuery.data ?? []

  return (
    <div className="admin-card admin-users">
      <div className="admin-card__head">USERS &amp; PER-DOMAIN PERMISSIONS</div>
      <div className="admin-users__scroll">
        <div className="admin-users__table" style={{ '--domains': Math.max(domains.length, 1) } as CSSProperties}>
          <div className="admin-users__row admin-users__row--head">
            <span className="admin-users__col-user">user</span>
            {domains.map((domain) => (
              <span key={domain.name} className="admin-users__col-domain admin-users__col-domain--head" title={domain.name}>
                {domain.name}
              </span>
            ))}
            <span className="admin-users__col-actions" />
          </div>
          {usersQuery.isError && <div className="admin-users__query-error">users unavailable — {messageOf(usersQuery.error)}</div>}
          {users.map((user) => (
            <UserRow key={user.name} apiClient={apiClient} user={user} domains={domains} domainsLoaded={domainsLoaded} />
          ))}
        </div>
      </div>
      <CreateUserRow apiClient={apiClient} />
      <div className="admin-card__footnote admin-card__footnote--tight">
        {'click a chip to cycle read · read+write · — · top chip: whole domain, below: keys, documents, tables'}
        <br />
        {'GET /store-api/auth/users · POST|DELETE /store-api/auth/users/{name}/permissions · new key shown once after rotate/create'}
      </div>
    </div>
  )
}
