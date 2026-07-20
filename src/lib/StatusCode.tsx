import './StatusCode.css'

export interface StatusCodeProps {
  status: number
  ms?: number
}

type Variant = 'ok' | 'err' | 'neutral'

function variantFor(status: number): Variant {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 0 || status >= 400) return 'err'
  return 'neutral'
}

/** Statuszahl mono, 2xx in --ok, 4xx/5xx (und Netzwerkfehler, status 0) in --err; optional Dauer `· 3.1 ms`. */
export function StatusCode({ status, ms }: StatusCodeProps) {
  return (
    <span className="status-code">
      <span className={`status-code__value status-code__value--${variantFor(status)}`}>{status}</span>
      {ms !== undefined && <span className="status-code__ms"> · {ms.toFixed(1)} ms</span>}
    </span>
  )
}
