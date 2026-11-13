import { useQuery } from '@tanstack/react-query'
import { useNavigate, type NavigateFunction } from 'react-router'
import { ApiError } from '../../api'
import { useCapabilities } from '../../app/capabilities'
import { useSession } from '../../app/session'
import { formatBytes } from '../../lib'
import { useSelectedDomain } from '../../shell'
import { domainsQueryOptions } from '../../shell/domains'
import { useJsonEngineTotals, useRelEngineTotals } from './domainMetrics'
import { EngineCard, type EngineCardRow } from './EngineCard'
import './EnginesScreen.css'
import { formatNumber } from '../../lib'
import { NUMBER_PLACEHOLDER } from './format'
import { healthQueryOptions } from './health'
import { HealthBar } from './HealthBar'
import { metricsQueryOptions, type EngineTone } from './metrics'
import { useEngineOpsHistory } from './rate'
import { RecentRequestsCard } from './RecentRequestsCard'
import { TasksJobsCard } from './TasksJobsCard'

function numberOrPlaceholder(loaded: boolean, value: number): string {
  return loaded ? formatNumber(value) : NUMBER_PLACEHOLDER
}

/** Domänen-Ziellogik der "open in:"-Links — auch von der Command-Palette genutzt (spec shell/008 §4). */
export function openDomainIn(navigate: NavigateFunction, select: (name: string) => void, domain: string, engine: EngineTone): void {
  select(domain)
  void navigate(`/data?engine=${engine}`)
}

/** Overview screen: three engine cards, Tasks & Jobs, Recent Requests. */
export function EnginesScreen() {
  const navigate = useNavigate()
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const { select } = useSelectedDomain()

  // Shared query options with the Explorer (shell/002): same key and queryFn, one cache entry for all three cards.
  const domainsQuery = useQuery(domainsQueryOptions(apiClient))
  const domainNames = (domainsQuery.data ?? []).map((domain) => domain.name)

  const healthQuery = useQuery(healthQueryOptions(apiClient))
  const metricsQuery = useQuery(metricsQueryOptions(apiClient))
  const history = useEngineOpsHistory(metricsQuery.data, metricsQuery.dataUpdatedAt)
  const health = healthQuery.data
  const isAdmin = useCapabilities().admin === 'yes'

  const jsonTotals = useJsonEngineTotals(apiClient, domainNames)
  const relTotals = useRelEngineTotals(apiClient, domainNames)

  const kvRows: EngineCardRow[] = [
    { label: 'domains', value: health ? formatNumber(health.domainCount) : NUMBER_PLACEHOLDER },
    { label: 'memtable keys (est.)', value: health ? formatNumber(health.estimatedMemtableKeys) : NUMBER_PLACEHOLDER },
    { label: 'L0 sstables', value: health ? formatNumber(health.l0SstableCount) : NUMBER_PLACEHOLDER },
    { label: 'vlog size', value: health ? formatBytes(health.vlogSizeBytes) : NUMBER_PLACEHOLDER },
  ]

  const jsonRows: EngineCardRow[] = [
    { label: 'domains', value: numberOrPlaceholder(domainsQuery.isSuccess, domainNames.length) },
    { label: 'documents', value: numberOrPlaceholder(jsonTotals.loaded, jsonTotals.documentCount) },
    { label: 'indexes', value: numberOrPlaceholder(jsonTotals.loaded, jsonTotals.indexCount) },
  ]

  const relRows: EngineCardRow[] = [
    { label: 'domains', value: numberOrPlaceholder(domainsQuery.isSuccess, domainNames.length) },
    { label: 'tables', value: numberOrPlaceholder(relTotals.loaded, relTotals.tableCount) },
    { label: 'views', value: numberOrPlaceholder(relTotals.loaded, relTotals.viewCount) },
  ]

  return (
    <div className="engines">
      {health && (
        <HealthBar
          health={health}
          resources={isAdmin ? metricsQuery.data?.resources : undefined}
          metricsUnavailable={isAdmin && metricsQuery.error instanceof ApiError && metricsQuery.error.status === 503}
        />
      )}
      <div className="engines__cards">
        <EngineCard
          tone="kv"
          title="KV ENGINE"
          online={domainsQuery.isSuccess}
          rows={kvRows}
          domains={domainNames}
          onOpenDomain={(domain) => openDomainIn(navigate, select, domain, 'kv')}
          metrics={metricsQuery.data?.engines.kv}
          spark={history.kv}
        />
        <EngineCard
          tone="json"
          title="JSON ENGINE"
          online={domainsQuery.isSuccess && !jsonTotals.off}
          rows={jsonRows}
          domains={domainNames}
          onOpenDomain={(domain) => openDomainIn(navigate, select, domain, 'json')}
          metrics={metricsQuery.data?.engines.json}
          spark={history.json}
        />
        <EngineCard
          tone="rel"
          title="REL ENGINE"
          online={domainsQuery.isSuccess && !relTotals.off}
          rows={relRows}
          domains={domainNames}
          onOpenDomain={(domain) => openDomainIn(navigate, select, domain, 'rel')}
          metrics={metricsQuery.data?.engines.rel}
          spark={history.rel}
        />
      </div>
      <div className="engines__bottom">
        <TasksJobsCard apiClient={apiClient} system={metricsQuery.data?.system} />
        <RecentRequestsCard />
      </div>
    </div>
  )
}
