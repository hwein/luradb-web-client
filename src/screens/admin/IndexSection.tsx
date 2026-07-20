import { useCapabilities } from '../../app/capabilities'
import { useSession } from '../../app/session'
import { AuthCard } from './AuthCard'
import { DomainsCard } from './DomainsCard'
import { UsersCard } from './UsersCard'

/** Designte Admin-Startseite (spec admin/001 §2–§4, admin/002 §1). */
export function IndexSection() {
  const { admin } = useCapabilities()
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined

  if (!admin) {
    return (
      <div className="admin-index admin-index--gate">
        <p className="admin-index__gate-text">admin role required — your key has per-domain permissions only</p>
      </div>
    )
  }

  return (
    <div className="admin-index">
      <div className="admin-index__grid">
        <div className="admin-index__column">
          <DomainsCard apiClient={apiClient} />
          <AuthCard />
        </div>
        <div className="admin-index__column admin-index__column--right">
          <UsersCard apiClient={apiClient} />
        </div>
      </div>
    </div>
  )
}
