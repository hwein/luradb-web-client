import { useState, type FormEvent } from 'react'
import type { Connection } from './connections'
import { maskKey } from './connections'
import { authFormFields, connectionFormFields, type FormFieldSpec } from './connectionRegistry'
import { getEnvironment } from './environment'

export type FormTarget = { mode: 'create' } | { mode: 'edit'; connection: Connection } | { mode: 'connect'; connection: Connection }

interface ConnectionFormProps {
  target: FormTarget
  onSubmit: (connection: Connection, remember: boolean) => void
  onCancel: () => void
}

const NAME_FIELD: FormFieldSpec = { name: 'name', label: 'Name', kind: 'text', required: true }

function fieldsFor(target: FormTarget): FormFieldSpec[] {
  const env = getEnvironment()
  if (target.mode === 'connect') return authFormFields('api-key')
  return [NAME_FIELD, ...connectionFormFields('rest', env), ...authFormFields('api-key')]
}

function initialValues(target: FormTarget): Record<string, string | boolean> {
  const base = target.mode === 'create' ? undefined : target.connection
  return {
    name: base?.name ?? '',
    url: base?.type.url ?? '',
    acceptInvalidCerts: base?.type.acceptInvalidCerts ?? false,
    key: '',
    remember: base?.auth.key !== undefined,
  }
}

/** Repariert Tippvarianten (`http:/host`, trailing Slash) über den WHATWG-Parser; Unparsbares bleibt roh (Connect meldet dann ehrlich unreachable). */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim()
  try {
    return new URL(trimmed).href.replace(/\/+$/, '')
  } catch {
    return trimmed
  }
}

function buildConnection(target: FormTarget, values: Record<string, string | boolean>): Connection {
  const typedKey = String(values.key ?? '')

  if (target.mode === 'connect') {
    const { connection } = target
    return { ...connection, auth: { kind: 'api-key', key: typedKey !== '' ? typedKey : connection.auth.key } }
  }

  const base = target.mode === 'edit' ? target.connection : undefined
  return {
    id: base?.id ?? crypto.randomUUID(),
    name: String(values.name ?? ''),
    type: {
      kind: 'rest',
      url: normalizeServerUrl(String(values.url ?? '')),
      acceptInvalidCerts: Boolean(values.acceptInvalidCerts),
    },
    auth: { kind: 'api-key', key: typedKey !== '' ? typedKey : base?.auth.key },
    lastUsed: base?.lastUsed,
  }
}

export function ConnectionForm({ target, onSubmit, onCancel }: ConnectionFormProps) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => initialValues(target))
  const fields = fieldsFor(target)
  const existingKey = target.mode !== 'create' ? target.connection.auth.key : undefined

  function setField(name: string, value: string | boolean): void {
    setValues((current) => ({ ...current, [name]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit(buildConnection(target, values), Boolean(values.remember))
  }

  return (
    <form className="connection-form" onSubmit={handleSubmit}>
      {target.mode === 'connect' && <p className="mono-path">connect to {target.connection.name}</p>}
      {fields.map((field) => (
        <ConnectionFormField
          key={field.name}
          field={field}
          value={values[field.name] ?? ''}
          onChange={(value) => setField(field.name, value)}
        />
      ))}
      {existingKey !== undefined && (
        <p className="connection-form__hint mono-path">current key: {maskKey(existingKey)} — leave blank to keep</p>
      )}
      <div className="connection-form__actions">
        <button type="submit" className="connection-form__submit">
          {target.mode === 'connect' ? 'Connect' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

interface ConnectionFormFieldProps {
  field: FormFieldSpec
  value: string | boolean
  onChange: (value: string | boolean) => void
}

function ConnectionFormField({ field, value, onChange }: ConnectionFormFieldProps) {
  if (field.kind === 'checkbox') {
    return (
      <div className="connection-form__field">
        <label className="connection-form__checkbox">
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
          {field.label}
        </label>
        {field.hint !== undefined && <span className="connection-form__hint mono-path">{field.hint}</span>}
      </div>
    )
  }
  return (
    <label className="connection-form__field">
      <span className="mono-label">{field.label}</span>
      <input
        className="connection-form__input"
        type={field.kind === 'secret' ? 'password' : 'text'}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.kind === 'secret' ? 'API key' : undefined}
        required={field.required === true}
        disabled={field.disabled === true}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.hint !== undefined && <span className="connection-form__hint mono-path">{field.hint}</span>}
    </label>
  )
}
