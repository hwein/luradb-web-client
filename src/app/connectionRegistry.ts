import { getTransport } from '../api/transport'
import type { AuthMethod, ConnectionType } from './connections'
import type { Environment } from './environment'

export interface FormFieldSpec {
  name: string
  label: string
  kind: 'text' | 'secret' | 'checkbox'
  required?: boolean
  /** Field is visible but not editable. */
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
    // One gate for both modes: the URL field always starts empty (no dev prefill in a shipped app);
    // in the browser it is optional — empty means this origin's proxy.
    if (env === 'browser') {
      return [
        {
          name: 'url',
          label: 'Server URL',
          kind: 'text',
          hint: 'leave empty to use this origin’s proxy — a direct URL only works if the server allows this origin in its [cors] section',
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
  serverUrl(type: RestType, env: Environment): string {
    if (env === 'desktop') return type.url
    return type.url === '' ? window.location.origin : type.url
  },
  buildTransport(type: RestType, env: Environment): Transport {
    const baseUrl = restType.serverUrl(type, env)
    if (env === 'desktop')
      return { baseUrl, fetchImpl: getTransport({ acceptInvalidCerts: type.acceptInvalidCerts === true }).fetchImpl }
    return { baseUrl, fetchImpl: fetch }
  },
  hostLabel(type: RestType, env: Environment): string {
    return new URL(restType.serverUrl(type, env)).host
  },
}

/** Effective server URL: in the browser an empty URL means this origin (proxy), a set URL is used directly (CORS). */
export function connectionServerUrl(type: ConnectionType, env: Environment): string {
  switch (type.kind) {
    case 'rest':
      return restType.serverUrl(type, env)
    default:
      return assertNever(type.kind)
  }
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
