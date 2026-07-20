export interface CallLineProps {
  method: string
  path: string
  note?: string
}

/** "Show the call" (Styleguide §05): eine Zeile im Muster `POST /store-api/… · note`. */
export function CallLine({ method, path, note }: CallLineProps) {
  return (
    <span className="mono-path">
      {method} {path}
      {note !== undefined && ` · ${note}`}
    </span>
  )
}
