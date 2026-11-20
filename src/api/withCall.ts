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
 * Runs a typed client call (`api.GET/POST/…`) and returns the call metadata with it,
 * so the caller can fill its own `<CallLine>`/`<StatusCode>` exactly; race-free with
 * parallel queries because the recorder is never searched for "the last call".
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
