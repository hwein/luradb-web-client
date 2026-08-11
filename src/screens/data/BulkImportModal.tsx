import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { ApiClient } from '../../api'
import { countNonEmptyLines, runBulkImport, type BulkImportResult } from './jsonBulkImport'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

interface BulkImportFormProps {
  domain: string
  apiClient: ApiClient | undefined
  onClose: () => void
}

/** Formular+Ergebnis des Bulk-Imports (spec data/007) — ohne <dialog>-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
export function BulkImportForm({ domain, apiClient, onClose }: BulkImportFormProps) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')

  const mutation = useMutation<BulkImportResult, unknown, string>({
    mutationFn: async (ndjson) => {
      if (!apiClient) throw new Error('no active connection')
      return runBulkImport(apiClient, domain, ndjson)
    },
    onSuccess: (result) => {
      if (result.imported > 0) {
        void queryClient.invalidateQueries({ queryKey: ['json-documents', domain] })
        void queryClient.invalidateQueries({ queryKey: ['json-domain-detail', domain] })
      }
    },
  })

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setText(reader.result)
    }
    reader.readAsText(file)
  }

  return (
    <>
      <div className="bim__head">
        <span id="bim-title" className="bim__title mono-label">
          bulk import · {domain}
        </span>
      </div>
      <div className="bim__body">
        <div className="bim__input-row">
          <label className="bim__file">
            load file…
            <input className="bim__file-input" type="file" accept=".ndjson,.jsonl,text/plain" onChange={handleFile} />
          </label>
          <span className="bim__line-count">{countNonEmptyLines(text)} lines</span>
        </div>
        <textarea
          className="bim__textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'{"_key": "a", "x": 1}\n{"_key": "b", "x": 2}'}
          aria-label="ndjson input"
          spellCheck={false}
        />
        {mutation.isError && <div className="bim__error">{messageOf(mutation.error)}</div>}
        {mutation.data !== undefined && (
          <div className="bim__result">
            <div className="bim__summary">
              imported {mutation.data.imported} ·{' '}
              <span className={mutation.data.failed > 0 ? 'bim__summary-failed' : undefined}>failed {mutation.data.failed}</span>
            </div>
            {mutation.data.errors.length > 0 && (
              <ul className="bim__error-list">
                {mutation.data.errors.map((entry, index) => (
                  <li key={`${entry.key}-${index}`} className="bim__error-entry">
                    {entry.key} · {entry.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="bim__footer">
        <button type="button" className="bim__close" onClick={onClose}>
          close
        </button>
        <button type="button" className="bim__import" disabled={mutation.isPending} onClick={() => mutation.mutate(text)}>
          {mutation.isPending ? 'importing…' : 'import'}
        </button>
      </div>
    </>
  )
}

interface BulkImportModalProps {
  domain: string
  apiClient: ApiClient | undefined
}

/** Einstiegspunkt "import ndjson ↑" (spec data/007 §1): natives `<dialog>` + `showModal()` um `BulkImportForm`. */
export function BulkImportModal({ domain, apiClient }: BulkImportModalProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || !open) return
    if (!dialog.open) {
      dialog.showModal()
      dialog.querySelector('textarea')?.focus()
    }
    function handleClose(): void {
      setOpen(false)
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [open])

  return (
    <>
      <button type="button" className="json__import-button" onClick={() => setOpen(true)}>
        import ndjson ↑
      </button>
      {open && (
        <dialog ref={dialogRef} className="bim" aria-labelledby="bim-title">
          <BulkImportForm domain={domain} apiClient={apiClient} onClose={() => setOpen(false)} />
        </dialog>
      )}
    </>
  )
}
