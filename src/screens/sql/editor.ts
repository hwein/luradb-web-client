import { sql, StandardSQL } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, Prec } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { EditorView } from 'codemirror'

// Keywords in accent color, strings amber (JSON hue). Prec.high beats the defaultHighlightStyle from minimalSetup.
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--acc)' },
  { tag: tags.string, color: 'var(--eng-json-label)' },
])

// Editor surface: mono, line-height 2, inner padding.
const sqlSizingTheme = EditorView.theme({
  '.cm-scroller': { fontSize: 'var(--fs-body)', lineHeight: '2' },
  '.cm-content': { padding: '16px 20px' },
})

/** SQL editor base extensions; the screen builds the shortcut keymap separately with live handlers. */
export const sqlBaseExtensions = [
  sql({ dialect: StandardSQL }),
  Prec.high(syntaxHighlighting(sqlHighlightStyle)),
  Prec.high(sqlSizingTheme),
]

/** Read-only preview (create-table modal): same highlighting, no input. A module constant because the `extensions` prop must be stable. */
export const sqlReadOnlyExtensions = [...sqlBaseExtensions, EditorState.readOnly.of(true), EditorView.editable.of(false)]
