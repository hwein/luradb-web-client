import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import { useSession } from '../../app/session'
import { CodeEditor } from '../../lib'
import { useSelectedDomain } from '../../shell'
import { useDomainSummaries } from '../../shell/domains'
import './SqlScreen.css'
import { SqlDocsSplit } from './SqlDocsSplit'
import { SqlResults } from './SqlResults'
import { SqlTabStrip } from './SqlTabStrip'
import { SqlToolbar } from './SqlToolbar'
import { sqlBaseExtensions } from './editor'
import { buildCreateViewSql, buildNdjson, executeSql, type SqlOutcome, type SqlSelectResult } from './sqlRun'
import {
  addTab,
  closeTab,
  renameTab,
  setActiveTab,
  setTabExpand,
  updateTabText,
  useSqlState,
} from './sqlStore'

function insertQueryFrom(state: unknown): string | undefined {
  if (state === null || typeof state !== 'object') return undefined
  const value = (state as { insertQuery?: unknown }).insertQuery
  return typeof value === 'string' ? value : undefined
}

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

/** LuraSQL-Konsole (spec sql/001): Editor-Tabs, Run, Expand-Chips, Ergebnis-Grid, togglebarer Docs-Split. */
export function SqlScreen() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const queryClient = useQueryClient()
  const { selected } = useSelectedDomain()
  const domains = useDomainSummaries(apiClient)
  const hasRel = domains.find((domain) => domain.name === selected)?.engines.rel !== undefined

  const { tabs, activeId } = useSqlState()
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  const [docsOpen, setDocsOpen] = useState(false)
  const [docsArticle, setDocsArticle] = useState('cross-engine-links')
  const [savingView, setSavingView] = useState(false)

  const location = useLocation()
  const navigate = useNavigate()

  // Alle Request-Parameter als mutate-Variablen: TanStack aktualisiert die mutationFn erst im Effect —
  // eine Closure über apiClient/selected wäre direkt nach einem Commit einen Render alt (Muster: JsonDetail).
  const run = useMutation<SqlOutcome, Error, { apiClient: ApiClient; domain: string; sql: string; expand: string[] }>({
    mutationFn: ({ apiClient: client, domain, sql, expand }) => executeSql(client, domain, sql, expand),
    onSuccess: (outcome, variables) => {
      // Schema-Änderungen (u. a. save-as-view) frisch in den Explorer spiegeln (spec §6).
      if (outcome.status === 'ok' && outcome.result.kind === 'ddl') {
        void queryClient.invalidateQueries({ queryKey: ['rel-tables', variables.domain] })
        void queryClient.invalidateQueries({ queryKey: ['rel-views', variables.domain] })
      }
    },
  })

  // Eine Quelle für Button-disabled UND Klick-Guard — sonst verpufft ein Klick im Fenster zwischen
  // Domänen-Query und Default-Selektion still (Button schon enabled, selected noch null).
  const canRun = hasRel && apiClient !== undefined && selected !== null && activeTab !== undefined && !run.isPending

  // Live-Handler in Refs, damit die (stabile) CodeMirror-Keymap immer den aktuellen Tab-Stand nutzt.
  const runRef = useRef<() => void>(() => {})
  const saveRef = useRef<() => void>(() => {})
  runRef.current = () => {
    if (!canRun || activeTab === undefined || apiClient === undefined || selected === null) return
    run.mutate({ apiClient, domain: selected, sql: activeTab.text, expand: activeTab.expand })
  }
  saveRef.current = () => {
    if (!hasRel || activeTab === undefined) return
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

  // Docs-„try in the console →" (docs/001) trägt {insertQuery} als Router-State — neuen Tab anlegen, State löschen.
  useEffect(() => {
    const query = insertQueryFrom(location.state)
    if (query === undefined) return
    addTab(query)
    void navigate('.', { replace: true, state: null })
  }, [location, navigate])

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
    run.mutate({ apiClient, domain: selected, sql: buildCreateViewSql(trimmed, activeTab.text), expand: [] })
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
          hasRel={hasRel}
          runDisabled={!canRun}
          expand={activeTab.expand}
          onExpandChange={(expand) => setTabExpand(activeTab.id, expand)}
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
