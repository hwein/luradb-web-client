import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { BASE_PATH, type ApiClient } from '../../api'
import { CallLine } from '../../lib'
import { jsonIndexesQueryOptions } from '../../shell/domainDetails'
import { BulkImportModal } from './BulkImportModal'
import { DataHeader } from './DataHeader'
import { IndexPanel } from './IndexPanel'
import { JsonDetail, type DetailMode } from './JsonDetail'
import { JsonMasterList } from './JsonMasterList'
import { isJsonObject, jsonDocumentsQueryOptions, safeJsonParse, type ParsedFilter } from './jsonDocuments'

interface JsonBrowserProps {
  domain: string
  apiClient: ApiClient | undefined
  initialKey: string | undefined
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/** Blob+Anchor-Download-Muster wie SqlScreen.tsx/ConfigScreen.tsx — lokal, kein Shared-Util (spec data/005). */
function downloadNdjson(domain: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${domain}.ndjson`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** JSON-Modus des Data Browsers (spec data/001): Kopf mit Idx/Filter/Search, Master-Detail, Footer-CallLine. */
export function JsonBrowser({ domain, apiClient, initialKey }: JsonBrowserProps) {
  const navigate = useNavigate()

  const [filterText, setFilterText] = useState('')
  const [filterError, setFilterError] = useState<string | undefined>(undefined)
  const [committedFilter, setCommittedFilter] = useState<ParsedFilter | undefined>(undefined)
  const [mode, setMode] = useState<DetailMode>({ kind: 'empty' })
  const [indexPanelOpen, setIndexPanelOpen] = useState(false)

  const indexesQuery = useQuery(jsonIndexesQueryOptions(apiClient, domain, true))
  const documentsQuery = useInfiniteQuery(jsonDocumentsQueryOptions(apiClient, domain, committedFilter))

  const exportMutation = useMutation<void, unknown, void>({
    mutationFn: async () => {
      if (!apiClient) throw new Error('no active connection')
      const response = await apiClient.fetchNdjson(`${BASE_PATH}/json/${encodeURIComponent(domain)}/export`)
      downloadNdjson(domain, await response.text())
    },
  })

  const pages = documentsQuery.data?.pages ?? []
  const documents = pages.flatMap((page) => page.documents)
  const lastPage = pages[pages.length - 1]

  // Neuer Domänen-/Filterkontext ⇒ Auswahl verwerfen, dann greift Auto-Select auf das erste Ergebnis.
  useEffect(() => {
    setMode({ kind: 'empty' })
  }, [domain, committedFilter])

  // Ankunft mit ?key= (spec data/009 §5, analog zur rel-Filter-Ankunft): einmalig initiale Selektion, danach normale Bedienung.
  useEffect(() => {
    if (initialKey !== undefined) setMode({ kind: 'view', key: initialKey })
  }, [domain, initialKey])

  useEffect(() => {
    const first = documents[0]
    if (mode.kind === 'empty' && first !== undefined) setMode({ kind: 'view', key: first.key })
  }, [mode, documents])

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const trimmed = filterText.trim()
    if (trimmed === '') {
      setFilterError(undefined)
      setCommittedFilter(undefined)
      return
    }
    const parsed = safeJsonParse(trimmed)
    if (!parsed.ok) {
      setFilterError(parsed.error)
      return
    }
    if (!isJsonObject(parsed.value)) {
      setFilterError('filter must be a JSON object')
      return
    }
    setFilterError(undefined)
    setCommittedFilter({ text: trimmed, value: parsed.value })
  }

  const indexPillText =
    indexesQuery.data && indexesQuery.data.length > 0 ? `idx: ${indexesQuery.data.map((index) => index.field).join(', ')}` : 'idx: —'

  function openRelTable(table: string, filterCol: string, filterVal: string): void {
    void navigate(`/data?${new URLSearchParams({ engine: 'rel', table, filterCol, filterVal }).toString()}`)
  }

  return (
    <div className="data">
      <DataHeader tone="json" letter="J" path={`${domain} / json documents`}>
        <button
          type="button"
          className={`data__idx-pill data__idx-pill--toggle${indexPanelOpen ? ' data__idx-pill--active' : ''}`}
          aria-expanded={indexPanelOpen}
          onClick={() => setIndexPanelOpen((open) => !open)}
        >
          {indexPillText} {indexPanelOpen ? '▾' : '▸'}
        </button>
        <form className="json__search" onSubmit={submitSearch}>
          <input
            className="json__filter-input"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder='{"city": "Essen"}'
            aria-label="document filter"
            spellCheck={false}
          />
          <button type="submit" className="json__search-button">
            Search
          </button>
        </form>
        <button type="button" className="json__export-button" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
          {exportMutation.isPending ? 'exporting…' : 'export ndjson ↓'}
        </button>
        <BulkImportModal domain={domain} apiClient={apiClient} />
      </DataHeader>
      {indexPanelOpen && apiClient !== undefined && (
        <IndexPanel domain={domain} apiClient={apiClient} indexes={indexesQuery.data ?? []} loading={indexesQuery.isLoading} />
      )}
      {filterError !== undefined && <div className="json__filter-error">{filterError}</div>}
      {exportMutation.isError && <div className="json__filter-error">{messageOf(exportMutation.error)}</div>}
      <div className="data__body">
        <JsonMasterList
          documents={documents}
          selectedKey={mode.kind === 'view' ? mode.key : undefined}
          onSelect={(key) => setMode({ kind: 'view', key })}
          onNew={() => setMode({ kind: 'new' })}
          loading={documentsQuery.isLoading}
          hasMore={documentsQuery.hasNextPage}
          loadingMore={documentsQuery.isFetchingNextPage}
          onLoadMore={() => void documentsQuery.fetchNextPage()}
        />
        <JsonDetail
          domain={domain}
          apiClient={apiClient}
          mode={mode}
          onSelectKey={(key) => setMode({ kind: 'view', key })}
          onClear={() => setMode({ kind: 'empty' })}
          onOpenRelTable={openRelTable}
        />
      </div>
      <div className="data__footer mono-path">
        {lastPage !== undefined ? (
          <>
            {formatNumber(documents.length)} of {formatNumber(lastPage.total)} ·{' '}
            <CallLine method={lastPage.call.method} path={lastPage.call.path} note={lastPage.call.bodyNote} />
          </>
        ) : documentsQuery.isLoading ? (
          'loading…'
        ) : null}
      </div>
    </div>
  )
}
