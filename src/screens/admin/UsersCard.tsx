import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, type ApiClient } from '../../api'
import { useDomainSummaries, type DomainSummary } from '../../shell/domains'
import { cellActionFor, primaryEngineFor, type CellValue } from './permissions'
import { createUser, deleteUser, rotateUserKey, USERS_KEY, usersQueryOptions, type CreateUserResponse, type RotateKeyResponse, type UserListItem } from './users'

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
const CELL_LABEL: Record<CellValue, string> = { unknown: '?', none: '—', read: 'read', write: 'read+write' }

function requireApiClient(apiClient: ApiClient | undefined): ApiClient {
  if (!apiClient) throw new Error('user admin action requires an active connection')
  return apiClient
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : 'request failed'
}

function initials(name: string): string {
  return name.slice(0, 2).toLowerCase()
}

function cellKey(userName: string, domainName: string): string {
  return `${userName}::${domainName}`
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

interface PermissionCellProps {
  apiClient: ApiClient | undefined
  userName: string
  domain: DomainSummary
  value: CellValue
  onChange: (next: CellValue) => void
}

/** Eine Zelle (spec admin/002 §2): Klick = sofortiger POST/DELETE, kein optimistisches Update. */
function PermissionCell({ apiClient, userName, domain, value, onChange }: PermissionCellProps) {
  const [error, setError] = useState<string | undefined>(undefined)
  const engine = primaryEngineFor(domain)

  const mutation = useMutation<CellValue, unknown, void>({
    mutationFn: async () => {
      if (!engine) throw new Error('domain has no engine to grant permissions on')
      const client = requireApiClient(apiClient)
      const action = cellActionFor(value)
      await action.perform(client, userName, domain.name, engine)
      return action.next
    },
    onSuccess: (next) => {
      setError(undefined)
      onChange(next)
    },
    onError: (err) => setError(messageOf(err)),
  })

  return (
    <span className="admin-users__col-domain">
      <button
        type="button"
        className={`admin-users__cell admin-users__cell--${value}`}
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || engine === undefined}
        title={value === 'unknown' ? 'current permission not readable — API provides write-only access' : undefined}
      >
        {CELL_LABEL[value]}
      </button>
      {error && <span className="admin-users__cell-error">{error}</span>}
    </span>
  )
}

type PendingAction = 'rotate' | 'delete' | undefined

interface UserRowProps {
  apiClient: ApiClient | undefined
  user: UserListItem
  domains: DomainSummary[]
  cells: Record<string, CellValue>
  onCellChange: (userName: string, domainName: string, next: CellValue) => void
}

/** Eine User-Zeile (spec admin/002 §1/§3): Avatar, admin-Badge oder Permission-Zellen, rotate/delete. */
function UserRow({ apiClient, user, domains, cells, onCellChange }: UserRowProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<PendingAction>(undefined)
  const [revealedKey, setRevealedKey] = useState<string | undefined>(undefined)
  const isAdmin = user.role === 'Admin'

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
        <span className="admin-users__col-user">
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
            <PermissionCell
              key={domain.name}
              apiClient={apiClient}
              userName={user.name}
              domain={domain}
              value={cells[cellKey(user.name, domain.name)] ?? 'unknown'}
              onChange={(next) => onCellChange(user.name, domain.name, next)}
            />
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
  const usersQuery = useQuery(usersQueryOptions(apiClient))
  const users = usersQuery.data ?? []
  // Session-Gedächtnis der Zellen: reiner In-Memory-State, bewusst kein sessionStorage (Reload ⇒ wieder "?").
  const [cells, setCells] = useState<Record<string, CellValue>>({})

  function handleCellChange(userName: string, domainName: string, next: CellValue): void {
    setCells((current) => ({ ...current, [cellKey(userName, domainName)]: next }))
  }

  return (
    <div className="admin-card admin-users">
      <div className="admin-card__head">USERS &amp; PER-DOMAIN PERMISSIONS</div>
      <div className="admin-users__row admin-users__row--head">
        <span className="admin-users__col-user">user</span>
        {domains.map((domain) => (
          <span key={domain.name} className="admin-users__col-domain">
            {domain.name}
          </span>
        ))}
        <span className="admin-users__col-actions" />
      </div>
      {users.map((user) => (
        <UserRow key={user.name} apiClient={apiClient} user={user} domains={domains} cells={cells} onCellChange={handleCellChange} />
      ))}
      <CreateUserRow apiClient={apiClient} />
      <div className="admin-card__footnote admin-card__footnote--tight">
        {'click a cell to cycle read · read+write · — (starts at ? — current permission not readable via the API)'}
        <br />
        {'POST /store-api/auth/users/{name}/permissions · new key shown once after rotate/create'}
      </div>
    </div>
  )
}
