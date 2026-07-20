import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useSelectedDomain } from '../../shell'
import { jsonDomainsQueryOptions, kvDomainsQueryOptions, relDomainsQueryOptions } from '../../shell/domains'
import { useJsonEngineTotals, useRelEngineTotals } from './domainMetrics'
import { EngineCard, type EngineCardRow, type EngineTone } from './EngineCard'
import './EnginesScreen.css'
import { formatBytes, formatNumber } from './format'
import { healthQueryOptions } from './health'
import { metricsQueryOptions } from './metrics'
import { RecentRequestsCard } from './RecentRequestsCard'
import { SystemThroughput } from './SystemThroughput'
import { TasksJobsCard } from './TasksJobsCard'

const NUMBER_PLACEHOLDER = '…'

function numberOrPlaceholder(loaded: boolean, value: number): string {
  return loaded ? formatNumber(value) : NUMBER_PLACEHOLDER
}

/** Übersichts-Screen (spec engines/001): SYSTEM-Durchsatz, drei Engine-Karten, Tasks & Jobs, Recent Requests. */
export function EnginesScreen() {
  const navigate = useNavigate()
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const { select } = useSelectedDomain()

  // Geteilte Query-Options mit Explorer/useConnection (shell/002): gleicher Key + gleiche queryFn, ein Cache-Eintrag.
  const kvDomainsQuery = useQuery(kvDomainsQueryOptions(apiClient))
  const jsonDomainsQuery = useQuery(jsonDomainsQueryOptions(apiClient))
  const relDomainsQuery = useQuery(relDomainsQueryOptions(apiClient))
  const kvDomains = kvDomainsQuery.data ?? []
  const jsonDomains = jsonDomainsQuery.data ?? []
  const relDomains = relDomainsQuery.data ?? []

  const healthQuery = useQuery(healthQueryOptions(apiClient))
  const metricsQuery = useQuery(metricsQueryOptions(apiClient))
  const health = healthQuery.data

  const jsonTotals = useJsonEngineTotals(
    apiClient,
    jsonDomains.map((domain) => domain.name),
  )
  const relTotals = useRelEngineTotals(
    apiClient,
    relDomains.map((domain) => domain.name),
  )

  function openDomainIn(domain: string, engine: EngineTone): void {
    select(domain)
    void navigate(`/data?engine=${engine}`)
  }

  const kvRows: EngineCardRow[] = [
    { label: 'domains', value: health ? formatNumber(health.domainCount) : NUMBER_PLACEHOLDER },
    { label: 'memtable keys (est.)', value: health ? formatNumber(health.estimatedMemtableKeys) : NUMBER_PLACEHOLDER },
    { label: 'L0 sstables', value: health ? formatNumber(health.l0SstableCount) : NUMBER_PLACEHOLDER },
    { label: 'vlog size', value: health ? formatBytes(health.vlogSizeBytes) : NUMBER_PLACEHOLDER },
  ]

  const jsonRows: EngineCardRow[] = [
    { label: 'domains', value: numberOrPlaceholder(jsonDomainsQuery.isSuccess, jsonDomains.length) },
    { label: 'documents', value: numberOrPlaceholder(jsonTotals.loaded, jsonTotals.documentCount) },
    { label: 'indexes', value: numberOrPlaceholder(jsonTotals.loaded, jsonTotals.indexCount) },
  ]

  const relRows: EngineCardRow[] = [
    { label: 'domains', value: numberOrPlaceholder(relDomainsQuery.isSuccess, relDomains.length) },
    { label: 'tables', value: numberOrPlaceholder(relTotals.loaded, relTotals.tableCount) },
    { label: 'views', value: numberOrPlaceholder(relTotals.loaded, relTotals.viewCount) },
  ]

  return (
    <div className="engines">
      <SystemThroughput metrics={metricsQuery.data} />
      <div className="engines__cards">
        <EngineCard
          tone="kv"
          title="KV ENGINE"
          online={kvDomainsQuery.isSuccess}
          rows={kvRows}
          domains={kvDomains.map((domain) => domain.name)}
          onOpenDomain={(domain) => openDomainIn(domain, 'kv')}
        />
        <EngineCard
          tone="json"
          title="JSON ENGINE"
          online={jsonDomainsQuery.isSuccess}
          rows={jsonRows}
          domains={jsonDomains.map((domain) => domain.name)}
          onOpenDomain={(domain) => openDomainIn(domain, 'json')}
        />
        <EngineCard
          tone="rel"
          title="REL ENGINE"
          online={relDomainsQuery.isSuccess}
          rows={relRows}
          domains={relDomains.map((domain) => domain.name)}
          onOpenDomain={(domain) => openDomainIn(domain, 'rel')}
        />
      </div>
      <div className="engines__bottom">
        <TasksJobsCard apiClient={apiClient} system={metricsQuery.data?.system} />
        <RecentRequestsCard />
      </div>
    </div>
  )
}
