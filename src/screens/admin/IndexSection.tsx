import { useCapabilities } from '../../app/capabilities'
import { useConnectedSession } from '../../app/session'
import { AuthCard } from './AuthCard'
import { BackupsCard } from './BackupsCard'
import { DomainsCard } from './DomainsCard'
import { ServerLogCard } from './ServerLogCard'
import { UsersCard } from './UsersCard'

/** Admin start page. */
export function IndexSection() {
  const { admin, adminError } = useCapabilities()
  const connected = useConnectedSession()

  // pending: the probe is still loading; no gate flash before the actual state is known.
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
