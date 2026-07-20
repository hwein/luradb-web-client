import { useState } from 'react'
import type { ConfigRow, EditableValue, PendingChange } from './configModel'
import { formatValue, MASKED_DISPLAY } from './configModel'

interface ConfigValueRowProps {
  row: ConfigRow
  pending: PendingChange | undefined
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onCommit: (value: EditableValue) => void
}

function TextEditor({
  initial,
  numeric,
  onCommit,
  onCancel,
}: {
  initial: string
  numeric: boolean
  onCommit: (value: EditableValue) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)

  function commit(): void {
    if (!numeric) {
      onCommit(draft)
      return
    }
    const trimmed = draft.trim()
    const parsed = Number(trimmed)
    if (trimmed === '' || Number.isNaN(parsed)) onCancel()
    else onCommit(parsed)
  }

  return (
    <input
      className={`config-row__input${numeric ? '' : ' config-row__input--text'}`}
      value={draft}
      inputMode={numeric ? 'decimal' : 'text'}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

/** Eine Key/Wert-Zeile mit Edit-Zuständen (spec §3): Input (Zahl/String), Bool-Toggle, Enum-Picker, `was <alt>`-Note. */
export function ConfigValueRow({ row, pending, editing, onStartEdit, onCancelEdit, onCommit }: ConfigValueRowProps) {
  const effective: EditableValue | unknown = pending ? pending.new : row.value
  const changed = pending !== undefined
  const wasNote = changed ? <span className="config-row__was">was {row.masked ? MASKED_DISPLAY : formatValue(row.value, false)}</span> : null

  if (row.kind === 'enum' && row.enumOptions) {
    return (
      <div className="config-row config-row--wrap">
        <span className="config-row__key config-row__key--full">{row.label}</span>
        <span className="config-seg" role="group">
          {row.enumOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`config-seg__opt${effective === option ? ' config-seg__opt--active' : ''}`}
              onClick={() => onCommit(option)}
            >
              {option}
            </button>
          ))}
        </span>
        {wasNote}
      </div>
    )
  }

  if (row.kind === 'boolean') {
    return (
      <div className="config-row">
        <span className="config-row__key">{row.label}</span>
        <button
          type="button"
          className="config-row__value config-row__value--editable config-row__value--bool"
          onClick={() => onCommit(!(effective as boolean))}
        >
          {effective ? 'true' : 'false'}
        </button>
        {wasNote}
      </div>
    )
  }

  if ((row.kind === 'number' || row.kind === 'string') && editing) {
    return (
      <div className="config-row config-row--wrap">
        <span className="config-row__key">{row.label}</span>
        <TextEditor
          initial={String(effective)}
          numeric={row.kind === 'number'}
          onCommit={onCommit}
          onCancel={onCancelEdit}
        />
        {wasNote}
      </div>
    )
  }

  if (row.editable) {
    return (
      <div className="config-row">
        <span className="config-row__key">{row.label}</span>
        <button
          type="button"
          className={`config-row__value config-row__value--editable${row.masked ? ' config-row__value--masked' : ''}`}
          onClick={onStartEdit}
        >
          {row.masked ? MASKED_DISPLAY : formatValue(effective, false)}
        </button>
        {row.masked ? <span className="config-row__warn">⚠</span> : null}
        {wasNote}
      </div>
    )
  }

  return (
    <div className="config-row">
      <span className="config-row__key">{row.label}</span>
      <span className={`config-row__value${row.masked ? ' config-row__value--masked' : ''}`}>{row.display}</span>
      {row.masked ? <span className="config-row__warn">⚠</span> : null}
    </div>
  )
}
