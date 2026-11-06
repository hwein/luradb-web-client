import { useQueryClient } from '@tanstack/react-query'
import { BASE_PATH } from '../api'
import { disconnect, useSession } from '../app/session'
import { useConnection } from '../app/useConnection'
import { LogoMark } from '../brand/LogoMark'
import './Statusbar.css'

export function Statusbar() {
  const queryClient = useQueryClient()
  const session = useSession()
  const { state, hostLabel, authLabel, signedInLabel, serverLabel, uptimeLabel, healthLabel, healthBlocked } = useConnection()
  const host = hostLabel.slice(0, hostLabel.length - BASE_PATH.length)

  function handleDisconnect(): void {
    disconnect()
    queryClient.clear()
  }

  return (
    <div className="statusbar">
      <button type="button" className="statusbar__connection" title="disconnect" onClick={handleDisconnect}>
        <span className={`statusbar__dot statusbar__dot--${state === 'connected' ? 'ok' : 'err'}`} />
        {state === 'connected' ? 'connected' : state}
      </button>
      {hostLabel && (
        <span>
          {host} {BASE_PATH}
        </span>
      )}
      {authLabel && <span>{authLabel}</span>}
      {signedInLabel && (
        <span className="statusbar__identity" title={signedInLabel}>
          {signedInLabel}
        </span>
      )}
      {session.status === 'connected' && session.compatibilityWarning && (
        <span className="statusbar__warning">⚠ {session.compatibilityWarning}</span>
      )}
      {healthLabel && (
        <span className={`statusbar__health${healthBlocked ? ' statusbar__health--err' : ''}`}>{healthLabel}</span>
      )}
      {serverLabel && (
        <span className="statusbar__server">
          <LogoMark size={20} />
          <span>{serverLabel}</span>
          {uptimeLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span>{uptimeLabel}</span>
            </>
          )}
        </span>
      )}
    </div>
  )
}
