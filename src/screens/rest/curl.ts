export interface CurlRequest {
  baseUrl: string
  method: string
  /** Konkreter Pfad (Parameter bereits eingesetzt). */
  path: string
  hasBody: boolean
  body: string
}

/** Platzhalter statt echtem Key — der API-Key erscheint nie im curl (spec §4). */
export const CURL_KEY_PLACEHOLDER = 'Bearer $LURADB_KEY'

export function buildCurl(request: CurlRequest): string {
  const lines = [`curl -X ${request.method} '${request.baseUrl}${request.path}'`, `  -H "Authorization: ${CURL_KEY_PLACEHOLDER}"`]
  if (request.hasBody && request.body.length > 0) {
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${request.body}'`)
  }
  return lines.join(' \\\n')
}
