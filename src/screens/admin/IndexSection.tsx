import { useCapabilities } from '../../app/capabilities'
import { useConnectedSession } from '../../app/session'
import { AuthCard } from './AuthCard'
import { BackupsCard } from './BackupsCard'
import { DomainsCard } from './DomainsCard'
import { ServerLogCard } from './ServerLogCard'
import { UsersCard } from './UsersCard'

/** Designte Admin-Startseite (spec admin/001 §2–§4, admin/002 §1). */
export function IndexSection() {
  const { admin, adminError } = useCapabilities()
  const connected = useConnectedSession()

  // pending: die Probe lädt noch — kein Gate-Aufblitzen, bevor der tatsächliche Stand feststeht (spec admin/005 §3).
  if (admin === 'pending') return null

  if (admin === 'no') {
    return (
      <div className="admin-index admin-index--gate">
        <p className="admin-index__gate-text">admin role required — your key has per-domain permissions only</p>
      </div>
    )
  }

  if (admin === 'error') {
    return (
      <div className="admin-index admin-index--gate">
        <p className="admin-index__gate-text admin-index__gate-text--err">admin check failed — {adminError}</p>
      </div>
    )
  }

  const apiClient = connected?.apiClient
  return (
    <div className="admin-index">
      <div className="admin-index__grid">
        <div className="admin-index__column">
          <DomainsCard apiClient={apiClient} />
          <AuthCard />
        </div>
        <div className="admin-index__column">
          <UsersCard apiClient={apiClient} />
          <div className="admin-index__lower">
            <BackupsCard apiClient={apiClient} />
            <ServerLogCard apiClient={apiClient} />
          </div>
        </div>
      </div>
    </div>
  )
}
