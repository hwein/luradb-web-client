import { useEffect, useRef } from 'react'
import { placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorView, minimalSetup } from 'codemirror'
import './CodeEditor.css'

/** Element-Typ der `extensions`-Prop (entspricht `Extension` aus @codemirror/state, ohne Direktimport). */
type CmExtension = typeof minimalSetup

// Theming über CSS-Variablen, damit beide Themes ohne JS-Neuaufbau greifen.
const baseTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--tx)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '11.5px', lineHeight: '1.7' },
  '.cm-content': { padding: '0', caretColor: 'var(--acc)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--acc)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--panel2)' },
  '.cm-placeholder': { color: 'var(--mut)' },
})

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Sprach-/Feature-Extensions; muss stabil sein (memoisieren), sonst baut der Editor bei jedem Render neu auf. */
  extensions?: CmExtension[]
  ariaLabel?: string
  placeholder?: string
}

/** Dünne React-Anbindung an CodeMirror 6 (kein Wrapper-Paket). Wiederverwendbar; sql/001 baut darauf auf. */
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

  return <div ref={hostRef} className="code-editor" />
}
