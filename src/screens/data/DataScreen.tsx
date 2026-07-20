import { useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { useSelectedDomain } from '../../shell'
import './DataScreen.css'
import { JsonBrowser } from './JsonBrowser'
import { KvBrowser } from './KvBrowser'
import { RelBrowser } from './RelBrowser'

type Engine = 'json' | 'kv' | 'rel'

function parseEngine(value: string | null): Engine {
  return value === 'kv' || value === 'rel' ? value : 'json'
}

/** Screen-Gerüst (spec §1): Modus+Objekt aus `?engine=&table=&filterCol=&filterVal=` (Deep-Link), ohne Ziel JSON-Modus der gewählten Domäne. */
export function DataScreen() {
  const [searchParams] = useSearchParams()
  const engine = parseEngine(searchParams.get('engine'))
  const table = searchParams.get('table') ?? undefined
  const filterCol = searchParams.get('filterCol') ?? undefined
  const filterVal = searchParams.get('filterVal') ?? undefined

  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const { selected } = useSelectedDomain()

  if (selected === null) {
    return (
      <div className="data">
        <div className="data__empty mono-data">no domain selected</div>
      </div>
    )
  }

  if (engine === 'kv') return <KvBrowser domain={selected} apiClient={apiClient} />
  if (engine === 'rel') {
    if (table === undefined) {
      return (
        <div className="data">
          <div className="data__empty mono-data">select a table from the explorer</div>
        </div>
      )
    }
    return <RelBrowser domain={selected} apiClient={apiClient} table={table} filterCol={filterCol} filterVal={filterVal} />
  }
  return <JsonBrowser domain={selected} apiClient={apiClient} />
}
