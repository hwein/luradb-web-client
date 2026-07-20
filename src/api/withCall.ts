export interface CallMeta {
  method: string
  path: string
  status: number
  ms: number
  bodyNote?: string
}

export interface CallResult<T> {
  data: T | undefined
  call: CallMeta
}

/**
 * Führt einen typisierten Client-Call aus (`api.GET/POST/…`) und liefert die Call-Metadaten dazu,
 * damit der Aufrufer seine eigene `<CallLine>`/`<StatusCode>` exakt füllen kann — race-frei bei
 * parallelen Queries, da nicht im Recorder nach „dem letzten Call" gesucht wird.
 */
export async function withCall<T>(
  method: string,
  fn: () => Promise<{ data?: T; response: Response }>,
  bodyNote?: string,
): Promise<CallResult<T>> {
  const start = performance.now()
  const { data, response } = await fn()
  return {
    data,
    call: {
      method,
      path: new URL(response.url).pathname,
      status: response.status,
      ms: performance.now() - start,
      bodyNote,
    },
  }
}
