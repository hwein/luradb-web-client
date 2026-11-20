export interface CurlRequest {
  baseUrl: string
  method: string
  /** Concrete path (parameters already filled in). */
  path: string
  hasBody: boolean
  body: string
}

/** Placeholder instead of the real key — the API key never appears in curl. */
export const CURL_KEY_PLACEHOLDER = 'Bearer $LURADB_KEY'

export function buildCurl(request: CurlRequest): string {
  const lines = [`curl -X ${request.method} '${request.baseUrl}${request.path}'`, `  -H "Authorization: ${CURL_KEY_PLACEHOLDER}"`]
  if (request.hasBody && request.body.length > 0) {
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${request.body}'`)
  }
  return lines.join(' \\\n')
}
