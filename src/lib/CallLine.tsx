export interface CallLineProps {
  method: string
  path: string
  note?: string
}

/** "Show the call": one line in the pattern `POST /store-api/… · note`. */
export function CallLine({ method, path, note }: CallLineProps) {
  return (
    <span className="mono-path selectable">
      {method} {path}
      {note !== undefined && ` · ${note}`}
    </span>
  )
}
