import { getTransport } from '../api/transport'
import type { AuthMethod, ConnectionType } from './connections'
import type { Environment } from './environment'

export interface FormFieldSpec {
  name: string
  label: string
  kind: 'text' | 'secret' | 'checkbox'
  required?: boolean
  /** Feld ist sichtbar, aber nicht editierbar (z. B. Server-URL im Browser-Modus). */
  disabled?: boolean
  /** Kurzer Hinweis unter dem Feld (mono, muted). */
  hint?: string
}

export interface Transport {
  baseUrl: string
  fetchImpl: typeof fetch
}

/** Exhaustiveness-Anker: neue Union-Varianten lassen jeden Aufrufer hier nicht mehr kompilieren. */
function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`)
}

// --- ConnectionType-Registry ---------------------------------------------

type RestType = Extract<ConnectionType, { kind: 'rest' }>

const restType = {
  formFields(env: Environment): FormFieldSpec[] {
    // Ein Gate für beide Modi (Autor-Vorgabe 2026-07-17): das URL-Feld ist immer da und startet LEER
    // (keine Dev-Vorbelegung in einer ausgelieferten App); im Browser-Modus nicht editierbar, weil der
    // Transport dort zwingend über den Origin-Proxy läuft.
    if (env === 'browser') {
      return [
        {
          name: 'url',
          label: 'Server URL',
          kind: 'text',
          disabled: true,
          hint: 'browser mode connects via this origin’s proxy — the URL is used by the desktop app',
        },
      ]
    }
    return [
      { name: 'url', label: 'Server URL', kind: 'text', required: true },
      {
        name: 'acceptInvalidCerts',
        label: 'Accept self-signed certificates',
        kind: 'checkbox',
        hint: 'disables all TLS certificate verification for this connection — any certificate is accepted and traffic (including the API key) could be intercepted',
      },
    ]
  },
  buildTransport(type: RestType, env: Environment): Transport {
    if (env === 'desktop')
      return { baseUrl: type.url, fetchImpl: getTransport({ acceptInvalidCerts: type.acceptInvalidCerts === true }).fetchImpl }
    return { baseUrl: window.location.origin, fetchImpl: fetch }
  },
  hostLabel(type: RestType, env: Environment): string {
    return env === 'desktop' ? new URL(type.url).host : window.location.host
  },
}

export function connectionFormFields(kind: ConnectionType['kind'], env: Environment): FormFieldSpec[] {
  switch (kind) {
    case 'rest':
      return restType.formFields(env)
    default:
      return assertNever(kind)
  }
}

export function buildTransport(type: ConnectionType, env: Environment): Transport {
  switch (type.kind) {
    case 'rest':
      return restType.buildTransport(type, env)
    default:
      return assertNever(type.kind)
  }
}

export function connectionHostLabel(type: ConnectionType, env: Environment): string {
  switch (type.kind) {
    case 'rest':
      return restType.hostLabel(type, env)
    default:
      return assertNever(type.kind)
  }
}

// --- AuthMethod-Registry --------------------------------------------------

type ApiKeyAuth = Extract<AuthMethod, { kind: 'api-key' }>

const apiKeyAuth = {
  formFields(): FormFieldSpec[] {
    return [
      { name: 'key', label: 'API Key', kind: 'secret' },
      { name: 'remember', label: 'Remember key', kind: 'checkbox' },
    ]
  },
  buildAuthHeader(auth: ApiKeyAuth): string | undefined {
    return auth.key === undefined ? undefined : `Bearer ${auth.key}`
  },
  statusLabel(roleLabel: string): string {
    return `bearer ✓ ${roleLabel}`
  },
  withoutSecret(auth: ApiKeyAuth): AuthMethod {
    return { ...auth, key: undefined }
  },
}

export function authFormFields(kind: AuthMethod['kind']): FormFieldSpec[] {
  switch (kind) {
    case 'api-key':
      return apiKeyAuth.formFields()
    default:
      return assertNever(kind)
  }
}

export function buildAuthHeader(auth: AuthMethod): string | undefined {
  switch (auth.kind) {
    case 'api-key':
      return apiKeyAuth.buildAuthHeader(auth)
    default:
      return assertNever(auth.kind)
  }
}

/** `roleLabel` kommt aus der Capability-Fassade (heute admin/user) — die Registry kennt keine Rollen. */
export function authStatusLabel(auth: AuthMethod, roleLabel: string): string {
  switch (auth.kind) {
    case 'api-key':
      return apiKeyAuth.statusLabel(roleLabel)
    default:
      return assertNever(auth.kind)
  }
}

export function authWithoutSecret(auth: AuthMethod): AuthMethod {
  switch (auth.kind) {
    case 'api-key':
      return apiKeyAuth.withoutSecret(auth)
    default:
      return assertNever(auth.kind)
  }
}
