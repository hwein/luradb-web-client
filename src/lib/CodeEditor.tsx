import { useEffect, useRef } from 'react'
import { placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorView, minimalSetup } from 'codemirror'
import './CodeEditor.css'

/** Element type of the `extensions` prop (like `Extension` from @codemirror/state, no direct import). */
type CmExtension = typeof minimalSetup

// Theming via CSS variables so both themes apply without a JS rebuild.
const baseTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--tx)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-meta)', lineHeight: '1.7' },
  '.cm-content': { padding: '0', caretColor: 'var(--acc)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--acc)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--panel2)' },
  '.cm-placeholder': { color: 'var(--mut)' },
})

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Language/feature extensions; must be stable (memoize), otherwise the editor is rebuilt on every render. */
  extensions?: CmExtension[]
  ariaLabel?: string
  placeholder?: string
}

/** Thin React binding for CodeMirror 6 (no wrapper package). Reusable. */
export function CodeEditor({ value, onChange, extensions, ariaLabel, placeholder }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const view = new EditorView({
      doc: valueRef.current,
      parent: host,
      extensions: [
        minimalSetup,
        EditorView.lineWrapping,
        baseTheme,
        ...(placeholder !== undefined ? [cmPlaceholder(placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        ...(extensions ?? []),
      ],
    })
    if (ariaLabel !== undefined) view.contentDOM.setAttribute('aria-label', ariaLabel)
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [extensions, ariaLabel, placeholder])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div ref={hostRef} className="code-editor selectable" />
}
