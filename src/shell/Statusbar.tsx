import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BASE_PATH, serverChangelog } from '../api'
import { endSession } from '../app/queryClient'
import { useSession } from '../app/session'
import { useConnection } from '../app/useConnection'
import { LogoMark } from '../brand/LogoMark'
import { WhatsNewModal } from './WhatsNewModal'
import './Statusbar.css'

export function Statusbar() {
  const queryClient = useQueryClient()
  const session = useSession()
  const { state, hostLabel, authLabel, signedInLabel, serverLabel, uptimeLabel, healthLabel, healthBlocked } = useConnection()
  const host = hostLabel.slice(0, hostLabel.length - BASE_PATH.length)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)

  const serverContent = (
    <>
      <LogoMark size={20} />
      <span>{serverLabel}</span>
      {uptimeLabel && (
        <>
          <span aria-hidden="true">·</span>
          <span>{uptimeLabel}</span>
        </>
      )}
    </>
  )

  return (
    <div className="statusbar">
      <button type="button" className="statusbar__connection" title="disconnect" onClick={() => endSession(queryClient)}>
        <span className={`statusbar__dot statusbar__dot--${state === 'connected' ? 'ok' : 'err'}`} />
        {state === 'connected' ? 'connected' : state}
      </button>
      {hostLabel && (
        <span className="selectable">
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
      {serverLabel &&
        (serverChangelog === null ? (
          <span className="statusbar__server">{serverContent}</span>
        ) : (
          <button
            type="button"
            className="statusbar__server statusbar__server--button"
            title="what's new in luradb"
            onClick={() => setWhatsNewOpen(true)}
          >
            {serverContent}
          </button>
        ))}
      {whatsNewOpen && serverChangelog !== null && session.status === 'connected' && (
        <WhatsNewModal changelog={serverChangelog} serverVersion={session.serverVersion} onClose={() => setWhatsNewOpen(false)} />
      )}
    </div>
  )
}
