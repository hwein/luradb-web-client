import { json } from '@codemirror/lang-json'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, BASE_PATH } from '../../api'
import { useSession } from '../../app/session'
import { CodeEditor, StatusCode, noteReindexStart } from '../../lib'
import { useSelectedDomain } from '../../shell'
import { buildCurl } from './curl'
import {
  applyPathParams,
  isDestructive,
  listEndpointGroups,
  methodTone,
  pathParamNames,
  type Endpoint,
  type HttpMethod,
} from './endpoints'
import './RestScreen.css'

const ENDPOINT_GROUPS = listEndpointGroups()

const REASON: Record<number, string> = {
  0: 'network error',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

function reasonPhrase(status: number): string {
  return REASON[status] ?? ''
}

function statusTone(status: number): 'ok' | 'err' | 'neutral' {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 0 || status >= 400) return 'err'
  return 'neutral'
}

function contextualInfo(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const total = (parsed as Record<string, unknown>).total
  return typeof total === 'number' ? `${total} total` : undefined
}

interface SendResult {
  status: number
  ms: number
  ok: boolean
  bodyText: string
  extra?: string
  curl: string
}

async function successResult(response: Response, ms: number, curl: string): Promise<SendResult> {
  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()
  if (contentType.includes('application/json') && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw)
      return { status: response.status, ms, ok: true, bodyText: JSON.stringify(parsed, null, 2), extra: contextualInfo(parsed), curl }
    } catch {
      // kein gültiges JSON trotz Header — als Rohtext zeigen
    }
  }
  return { status: response.status, ms, ok: true, bodyText: raw, curl }
}

function errorResult(error: ApiError, ms: number, curl: string): SendResult {
  const bodyText =
    error.body === undefined ? error.message : typeof error.body === 'string' ? error.body : JSON.stringify(error.body, null, 2)
  return { status: error.status, ms, ok: false, bodyText, curl }
}

/** REST Explorer (spec rest/001): Request-Builder über den gebündelten Contract + Roh-Response. */
export function RestScreen() {
  const session = useSession()
  const apiClient = session.status === 'connected' ? session.apiClient : undefined
  const serverUrl = session.status === 'connected' ? session.connection.type.url : window.location.origin
  const { selected } = useSelectedDomain()

  const [method, setMethod] = useState<HttpMethod>('GET')
  const [path, setPath] = useState(`${BASE_PATH}/domains`)
  const [hasBody, setHasBody] = useState(false)
  const [body, setBody] = useState('')
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [armed, setArmed] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState<string | null>(null)

  const bodyExtensions = useMemo(() => [json()], [])
  const paramNames = pathParamNames(path)

  // Methoden-/Pfadwechsel entwaffnet den destruktiven Guard.
  useEffect(() => {
    setArmed(false)
  }, [method, path])

  function effectiveParam(name: string): string {
    const explicit = paramValues[name]
    if (explicit !== undefined) return explicit
    return name === 'domain' ? (selected ?? '') : ''
  }

  // Request komplett als mutate-Variablen: TanStack aktualisiert die mutationFn erst im Effect — Closures
  // über method/path/selected wären direkt nach einem Commit einen Render alt (Muster: JsonDetail/SqlScreen).
  interface SendRequest {
    client: NonNullable<typeof apiClient>
    method: HttpMethod
    concretePath: string
    requestInit: RequestInit
    curl: string
  }
  const send = useMutation<SendResult, Error, SendRequest>({
    mutationFn: async ({ client, method: sendMethod, concretePath, requestInit, curl }) => {
      const start = performance.now()
      try {
        const response = await client.fetchRaw(concretePath, requestInit)
        // Task-Erwerb (spec engines/001 Orchestrator-Hinweis 1): matcht intern auf reindex-Pfade,
        // no-op für jeden anderen POST — daher unbedingt versucht, nicht nur bei bekanntem Endpunkt.
        if (sendMethod === 'POST') {
          try {
            noteReindexStart(concretePath, await response.clone().json())
          } catch {
            // kein JSON-Body — kein Reindex-Response, nichts zu registrieren
          }
        }
        return await successResult(response, performance.now() - start, curl)
      } catch (error) {
        if (error instanceof ApiError) return errorResult(error, performance.now() - start, curl)
        throw error
      }
    },
  })

  function buildSendRequest(): SendRequest | undefined {
    if (apiClient === undefined) return undefined
    const values: Record<string, string> = {}
    for (const name of paramNames) values[name] = effectiveParam(name)
    const concretePath = applyPathParams(path, values)

    const requestInit: RequestInit = { method }
    if (hasBody && body.length > 0) {
      requestInit.headers = { 'Content-Type': 'application/json' }
      requestInit.body = body
    }
    const curl = buildCurl({ baseUrl: serverUrl, method, path: concretePath, hasBody, body })
    return { client: apiClient, method, concretePath, requestInit, curl }
  }

  const result = send.data

  function selectEndpoint(endpoint: Endpoint): void {
    setMethod(endpoint.method)
    setPath(endpoint.path)
    setHasBody(endpoint.hasBody)
    setBody(endpoint.bodyExample)
    setParamValues({})
  }

  function handleSend(): void {
    if (isDestructive(method, path) && !armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    const request = buildSendRequest()
    if (request !== undefined) send.mutate(request)
  }

  function handleCopyCurl(): void {
    if (result === undefined) return
    void navigator.clipboard?.writeText(result.curl)
    setCopiedCurl(result.curl)
  }

  const destructiveArmed = armed && isDestructive(method, path)
  const showCopied = result !== undefined && copiedCurl === result.curl

  return (
    <div className="rest">
      <div className="rest__builder">
        <div className="rest__builder-header">
          <span className={`rest__method rest__method--${methodTone(method)}`}>{method}</span>
          <input
            className="rest__url"
            value={path}
            aria-label="request url"
            spellCheck={false}
            onChange={(event) => setPath(event.target.value)}
          />
          <button
            type="button"
            className={`rest__send${destructiveArmed ? ' rest__send--armed' : ''}`}
            onClick={handleSend}
            disabled={send.isPending}
          >
            {destructiveArmed ? `send ${method} — sure?` : 'Send'}
          </button>
        </div>

        {paramNames.length > 0 && (
          <div className="rest__params">
            {paramNames.map((name) => (
              <label key={name} className="rest__param">
                <span className="rest__param-name">{`{${name}}`}</span>
                <input
                  className="rest__param-input"
                  value={effectiveParam(name)}
                  aria-label={`path parameter ${name}`}
                  spellCheck={false}
                  onChange={(event) => setParamValues((current) => ({ ...current, [name]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        )}

        {hasBody && (
          <div className="rest__body">
            <div className="mono-label rest__section-label">BODY</div>
            <CodeEditor value={body} onChange={setBody} extensions={bodyExtensions} ariaLabel="request body" />
          </div>
        )}

        <div className="mono-label rest__section-label rest__endpoints-header">ENDPOINTS · from OpenAPI</div>
        <div className="rest__endpoints">
          {ENDPOINT_GROUPS.map((group) => (
            <div key={group.tag} className="rest__group">
              <div className="rest__group-label">{group.tag}</div>
              {group.endpoints.map((endpoint) => {
                const active = endpoint.method === method && endpoint.path === path
                return (
                  <button
                    key={`${endpoint.method} ${endpoint.path}`}
                    type="button"
                    className={`rest__endpoint${active ? ' rest__endpoint--active' : ''}`}
                    aria-label={`${endpoint.method} ${endpoint.displayPath}`}
                    onClick={() => selectEndpoint(endpoint)}
                  >
                    <span className={`rest__endpoint-method rest__method--${methodTone(endpoint.method)}`}>{endpoint.method}</span>
                    <span className="rest__endpoint-path">{endpoint.displayPath}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <a className="rest__swagger" href={`${serverUrl}/test-ui`} target="_blank" rel="noreferrer">
          see also: /test-ui ↗
        </a>
      </div>

      <div className="rest__response">
        <div className="rest__status-line">
          {send.isPending ? (
            <span className="rest__pending">sending…</span>
          ) : result !== undefined ? (
            <>
              <StatusCode status={result.status} />
              {reasonPhrase(result.status) !== '' && (
                <span className={`rest__reason rest__reason--${statusTone(result.status)}`}>{reasonPhrase(result.status)}</span>
              )}
              <span className="rest__meta">
                {result.ms.toFixed(1)} ms{result.extra !== undefined ? ` · ${result.extra}` : ''}
              </span>
              <button type="button" className="rest__copy-curl" onClick={handleCopyCurl}>
                {showCopied ? 'copied ✓' : 'copy as curl'}
              </button>
            </>
          ) : null}
        </div>
        {result !== undefined ? (
          <pre className="rest__response-body">{result.bodyText}</pre>
        ) : (
          <div className="rest__response-empty">send a request to see the response</div>
        )}
      </div>
    </div>
  )
}
