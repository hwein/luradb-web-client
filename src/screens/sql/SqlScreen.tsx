import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import type { ApiClient } from '../../api'
import { useSession } from '../../app/session'
import { CodeEditor } from '../../lib'
import { useSelectedDomain } from '../../shell'
import { relTableCountDomainPrefix, relTablesKey, relViewsKey } from '../../shell/domainDetails'
import { useDomainSummaries } from '../../shell/domains'
import './SqlScreen.css'
import { SqlDocsSplit } from './SqlDocsSplit'
import { SqlResults } from './SqlResults'
import { SqlTabStrip } from './SqlTabStrip'
import { SqlToolbar } from './SqlToolbar'
import { sqlBaseExtensions } from './editor'
import { buildCreateViewSql, buildNdjson, executeSql, parseParams, type SqlOutcome, type SqlSelectResult } from './sqlRun'
import {
  addTab,
  closeTab,
  renameTab,
  setActiveTab,
  setTabExpand,
  updateTabParams,
  updateTabText,
  useSqlState,
} from './sqlStore'

function SaveViewBar({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <form
      className="sql-saveview"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(name)
      }}
    >
      <span className="sql-saveview__label mono-label">SAVE AS VIEW</span>
      <input
        className="sql-saveview__input"
        aria-label="view name"
        placeholder="view_name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      />
      <button type="submit" className="sql-saveview__save">
        save
      </button>
      <button type="button" className="sql-saveview__cancel" onClick={onCancel}>
        cancel
      </button>
    </form>
  )
}

/** LuraSQL console: editor tabs, run, expand chips, result grid, toggleable docs split. */
export function SqlScreen() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const queryClient = useQueryClient()
  const { selected } = useSelectedDomain()
  const domains = useDomainSummaries(apiClient)
  const domainListed = domains.some((domain) => domain.name === selected)

  const { tabs, activeId } = useSqlState()
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  const [docsOpen, setDocsOpen] = useState(false)
  const [docsArticle, setDocsArticle] = useState('lurasql')
  const [savingView, setSavingView] = useState(false)

  // All request parameters are mutate variables: TanStack only updates the mutationFn in an effect,
  // so a closure over apiClient/selected would be one render stale right after a commit.
  const run = useMutation<SqlOutcome, Error, { apiClient: ApiClient; domain: string; sql: string; expand: string[]; params: unknown[] }>({
    mutationFn: ({ apiClient: client, domain, sql, expand, params }) => executeSql(client, domain, sql, expand, params),
    onSuccess: (outcome, variables) => {
      if (outcome.status !== 'ok') return
      // Reflect schema changes (e.g. save-as-view) in the explorer.
      if (outcome.result.kind === 'ddl') {
        void queryClient.invalidateQueries({ queryKey: relTablesKey(variables.domain) })
        void queryClient.invalidateQueries({ queryKey: relViewsKey(variables.domain) })
      }
      // Row counts of the domain; the result does not name the affected table, so invalidate by prefix.
      if (outcome.result.kind === 'ddl' || outcome.result.kind === 'dml') {
        void queryClient.invalidateQueries({ queryKey: relTableCountDomainPrefix(variables.domain) })
      }
    },
  })

  // Raw text field, parsed for the run guard and the body; empty/whitespace gives ok with [].
  const paramsResult = parseParams(activeTab?.params ?? '')
  const paramsError = paramsResult.ok ? undefined : paramsResult.error

  // One source for button-disabled AND the click guard, or a click between the domains query and
  // the default selection is silently lost (button already enabled, selected still null).
  const canRun = domainListed && apiClient !== undefined && selected !== null && activeTab !== undefined && paramsError === undefined && !run.isPending

  // Live handlers in refs so the (stable) CodeMirror keymap always sees the current tab state.
  const runRef = useRef<() => void>(() => {})
  const saveRef = useRef<() => void>(() => {})
  runRef.current = () => {
    if (!canRun || activeTab === undefined || apiClient === undefined || selected === null || !paramsResult.ok) return
    run.mutate({ apiClient, domain: selected, sql: activeTab.text, expand: activeTab.expand, params: paramsResult.params })
  }
  saveRef.current = () => {
    if (!domainListed || activeTab === undefined) return
    setSavingView(true)
  }

  const editorExtensions = useMemo(
    () => [
      ...sqlBaseExtensions,
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              runRef.current()
              return true
            },
          },
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              saveRef.current()
              return true
            },
          },
        ]),
      ),
    ],
    [],
  )

  function openDocSplit(docId: string): void {
    setDocsArticle(docId)
    setDocsOpen(true)
  }

  function handleExport(result: SqlSelectResult): void {
    const blob = new Blob([buildNdjson(result)], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(activeTab?.name ?? 'results').replace(/\.sql$/, '')}.ndjson`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function submitSaveView(name: string): void {
    setSavingView(false)
    const trimmed = name.trim()
    if (trimmed === '' || activeTab === undefined || apiClient === undefined || selected === null) return
    run.mutate({ apiClient, domain: selected, sql: buildCreateViewSql(trimmed, activeTab.text), expand: [], params: [] })
  }

  if (activeTab === undefined) return null

  return (
    <div className="sql">
      <div className="sql__editor-col">
        <SqlTabStrip
          tabs={tabs}
          activeId={activeTab.id}
          domainName={selected}
          onSelect={setActiveTab}
          onClose={closeTab}
          onRename={renameTab}
          onAdd={() => addTab()}
        />
        <SqlToolbar
          apiClient={apiClient}
          domainName={selected}
          domainListed={domainListed}
          runDisabled={!canRun}
          expand={activeTab.expand}
          onExpandChange={(expand) => setTabExpand(activeTab.id, expand)}
          params={activeTab.params}
          onParamsChange={(params) => updateTabParams(activeTab.id, params)}
          paramsError={paramsError}
          onRun={() => runRef.current()}
          running={run.isPending}
          docsOpen={docsOpen}
          onToggleDocs={() => setDocsOpen((open) => !open)}
        />
        {savingView && <SaveViewBar onSubmit={submitSaveView} onCancel={() => setSavingView(false)} />}
        <div className="sql__editor">
          <CodeEditor
            value={activeTab.text}
            onChange={(text) => updateTabText(activeTab.id, text)}
            extensions={editorExtensions}
            ariaLabel="sql editor"
          />
        </div>
        <SqlResults outcome={run.data} running={run.isPending} onExport={handleExport} onOpenDoc={openDocSplit} />
      </div>
      {docsOpen && <SqlDocsSplit articleId={docsArticle} onArticleChange={setDocsArticle} onClose={() => setDocsOpen(false)} />}
    </div>
  )
}
