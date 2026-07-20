import { useQueries, useQuery } from '@tanstack/react-query'
import type { ApiClient } from '../api'
import { relTableDetailQueryOptions, relTablesQueryOptions } from './domainDetails'
import type { DomainSummary } from './domains'

interface DomainLinksPanelProps {
  apiClient: ApiClient | undefined
  domain: DomainSummary
}

interface LinkEntry {
  table: string
  column: string
  type: 'KVREF' | 'JSONREF'
}

/** "LINKS IN {DOMAIN}" (spec shell/002 §5): KVREF-/JSONREF-Spalten aller rel-Tabellen der expandierten Domäne. */
export function DomainLinksPanel({ apiClient, domain }: DomainLinksPanelProps) {
  const hasRel = domain.engines.rel !== undefined
  const tablesQuery = useQuery(relTablesQueryOptions(apiClient, domain.name, hasRel))
  const tables = tablesQuery.data ?? []

  const detailQueries = useQueries({
    queries: tables.map((table) => relTableDetailQueryOptions(apiClient, domain.name, table.name, hasRel)),
  })

  if (!hasRel) return null

  const links: LinkEntry[] = tables.flatMap((table, index) => {
    const detail = detailQueries[index]?.data
    if (!detail) return []
    return detail.columns
      .filter((column) => column.type === 'KVREF' || column.type === 'JSONREF')
      .map((column) => ({ table: table.name, column: column.name, type: column.type as 'KVREF' | 'JSONREF' }))
  })

  if (links.length === 0) return null

  return (
    <>
      <div className="explorer__label explorer__label--links">LINKS IN {domain.name.toUpperCase()}</div>
      <div className="explorer__links-box">
        {links.map((link) => (
          <div key={`${link.table}.${link.column}`} className="explorer__link-entry">
            <div>
              {link.table}.{link.column}
            </div>
            <div className="explorer__link-target">
              <span className={`explorer__link-type explorer__link-type--${link.type === 'JSONREF' ? 'json' : 'kv'}`}>{link.type}</span>{' '}
              ⟶ {link.type === 'JSONREF' ? 'json docs' : 'kv keys'}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
