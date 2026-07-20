import { sql, StandardSQL } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, Prec } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { EditorView } from 'codemirror'

// Keywords in Akzent, Strings amber (JSON-Hue) — spec §1. Prec.high schlägt defaultHighlightStyle aus minimalSetup.
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--acc)' },
  { tag: tags.string, color: 'var(--eng-json-label)' },
])

// Editor-Fläche: mono 13px, line-height 2, Innenabstand wie im Prototyp (Z. 76).
const sqlSizingTheme = EditorView.theme({
  '.cm-scroller': { fontSize: '13px', lineHeight: '2' },
  '.cm-content': { padding: '16px 20px' },
})

/** Basis-Extensions des SQL-Editors; die Shortcut-Keymap baut der Screen mit Live-Handlern separat. */
export const sqlBaseExtensions = [
  sql({ dialect: StandardSQL }),
  Prec.high(syntaxHighlighting(sqlHighlightStyle)),
  Prec.high(sqlSizingTheme),
]

/** Read-only Vorschau (Create-Table-Modal, spec sql/002 §6): gleiches Highlighting, keine Eingabe. Modul-Konstante — die `extensions`-Prop muss stabil sein. */
export const sqlReadOnlyExtensions = [...sqlBaseExtensions, EditorState.readOnly.of(true), EditorView.editable.of(false)]
