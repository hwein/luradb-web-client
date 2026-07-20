import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api'
import type { components } from '../../api/schema'
import { primaryKeyColumn } from './referencedBy'
import { checkDanglingLinks, isLinkColumn, type DanglingLinksReport } from './relRows'

type ColumnInfo = components['schemas']['ColumnInfo']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

interface DanglingReportContentProps {
  apiClient: ApiClient | undefined
  domain: string
  table: string
  columns: ColumnInfo[]
  onClose: () => void
}

/** Inhalt des Dangling-Reports (spec 004 §4) — ohne <dialog>-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
export function DanglingReportContent({ apiClient, domain, table, columns, onClose }: DanglingReportContentProps) {
  const navigate = useNavigate()

  const mutation = useMutation<DanglingLinksReport, unknown, void>({
    mutationFn: async () => {
      if (!apiClient) throw new Error('no active connection')
      return checkDanglingLinks(apiClient, domain, table, columns)
    },
  })

  const mutate = mutation.mutate
  useEffect(() => {
    // Läuft genau einmal beim Öffnen (`mutate` ist stabil) — dieser Inhalt mountet erst, wenn der Dialog aufgeht.
    mutate()
  }, [mutate])

  function handleJump(pk: string): void {
    const pkColumn = primaryKeyColumn(columns)
    if (pkColumn === undefined) return
    onClose()
    void navigate(`/data?${new URLSearchParams({ engine: 'rel', table, filterCol: pkColumn, filterVal: pk }).toString()}`)
  }

  return (
    <>
      <div className="dlr__head">
        <span id="dlr-title" className="dlr__title mono-label">
          check links · {table}
        </span>
      </div>
      <div className="dlr__body">
        {mutation.isPending && <div className="dlr__hint">checking…</div>}
        {mutation.isError && <div className="dlr__error">{messageOf(mutation.error)}</div>}
        {mutation.data !== undefined && (
          <>
            {mutation.data.truncated && <div className="dlr__hint">checked first {formatNumber(mutation.data.checked)} rows</div>}
            {mutation.data.entries.length === 0 ? (
              <div className="dlr__hint">no dangling links</div>
            ) : (
              <ul className="dlr__list">
                {mutation.data.entries.map((entry, index) => (
                  <li key={`${entry.pk}.${entry.column}.${index}`}>
                    <button type="button" className="dlr__entry" onClick={() => handleJump(entry.pk)}>
                      {entry.pk} · {entry.column}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="dlr__footer">
        <button type="button" className="dlr__close" onClick={onClose}>
          close
        </button>
      </div>
    </>
  )
}

interface DanglingReportProps {
  apiClient: ApiClient | undefined
  domain: string
  table: string
  columns: ColumnInfo[]
}

/** Toolbar-Report "check links" (spec 004 §4): natives `<dialog>` + `showModal()` um `DanglingReportContent`, nur mit Link-Spalten sichtbar. */
export function DanglingReport({ apiClient, domain, table, columns }: DanglingReportProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || !open) return
    if (!dialog.open) dialog.showModal()
    function handleClose(): void {
      setOpen(false)
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [open])

  if (!columns.some(isLinkColumn)) return null

  return (
    <>
      <button type="button" className="rel-list__check-links" onClick={() => setOpen(true)}>
        check links
      </button>
      {open && (
        <dialog ref={dialogRef} className="dlr" aria-labelledby="dlr-title">
          <DanglingReportContent apiClient={apiClient} domain={domain} table={table} columns={columns} onClose={() => setOpen(false)} />
        </dialog>
      )}
    </>
  )
}
