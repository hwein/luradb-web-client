import { useQuery } from '@tanstack/react-query'
import { useConnectedSession } from '../../app/session'
import { authEnabledProbeQueryOptions } from './authProbe'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

function AuthEnabledValue({ enabled }: { enabled: boolean | undefined }) {
  if (enabled === undefined) return <span className="admin-auth__row-value admin-auth__row-value--muted">…</span>
  return (
    <span className={`admin-auth__row-value ${enabled ? 'admin-auth__row-value--ok' : 'admin-auth__row-value--err'}`}>{String(enabled)}</span>
  )
}

/** AUTH-Karte (spec admin/001 §4): auth.enabled per anonymer Probe abgeleitet, scheme statisch, Erklärtext. */
export function AuthCard() {
  const connected = useConnectedSession()
  const probe = useQuery(authEnabledProbeQueryOptions(connected?.apiClient))

  return (
    <div className="admin-card">
      <div className="admin-card__head">AUTH</div>
      <div className="admin-auth__row">
        <span className="admin-auth__row-label">auth.enabled</span>
        <AuthEnabledValue enabled={probe.data} />
      </div>
      <div className="admin-auth__row">
        <span className="admin-auth__row-label">scheme</span>
        <span className="admin-auth__row-value">bearer api-key</span>
      </div>
      {probe.data === false && (
        <div className="admin-auth__warning">⚠ no key required — this server accepts requests without an API key</div>
      )}
      {probe.isError && <div className="admin-auth__error">auth state unavailable — {messageOf(probe.error)}</div>}
      <div className="admin-card__footnote">admins live in luradb.toml (restart to apply) — users &amp; keys below are managed live via /store-api/auth</div>
    </div>
  )
}
