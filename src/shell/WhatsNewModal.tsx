import { useEffect, useRef, type ReactNode } from 'react'
import { compareSemVer, parseSemVer } from '../api'
import type { ServerChangelog } from '../api'
import { LogoMark } from '../brand/LogoMark'
import './WhatsNewModal.css'

interface WhatsNewProps {
  changelog: ServerChangelog
  serverVersion: string
  onClose: () => void
}

/** Text between two `**` becomes <strong>; an unpaired `**` stays literal. */
function pushBold(nodes: ReactNode[], text: string): void {
  let rest = text
  while (rest !== '') {
    const open = rest.indexOf('**')
    const close = open === -1 ? -1 : rest.indexOf('**', open + 2)
    if (close === -1) {
      nodes.push(rest)
      return
    }
    if (open > 0) nodes.push(rest.slice(0, open))
    nodes.push(<strong key={nodes.length}>{rest.slice(open + 2, close)}</strong>)
    rest = rest.slice(close + 2)
  }
}

/** Text between two backticks becomes <code>, between two `**` outside code <strong>; unpaired markers stay literal. */
function renderInlineCode(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  while (rest !== '') {
    const open = rest.indexOf('`')
    const close = open === -1 ? -1 : rest.indexOf('`', open + 1)
    if (close === -1) {
      pushBold(nodes, rest)
      break
    }
    if (open > 0) pushBold(nodes, rest.slice(0, open))
    nodes.push(<code key={nodes.length}>{rest.slice(open + 1, close)}</code>)
    rest = rest.slice(close + 1)
  }
  return nodes
}

/** Content of the what's-new dialog — without the <dialog> shell, so tests can mount it without `showModal()`. */
export function WhatsNewContent({ changelog, serverVersion, onClose }: WhatsNewProps) {
  const newest = changelog.releases[0]
  if (newest === undefined) return null
  const order = compareSemVer(parseSemVer(serverVersion), parseSemVer(newest.version))

  return (
    <>
      <div className="whats-new__head">
        <LogoMark size={28} />
        <div className="whats-new__heading">
          <span id="whats-new-title" className="whats-new__name">
            what's new in luradb
          </span>
          <span className="whats-new__upto mono-data">
            up to v{newest.version} · {newest.date}
          </span>
        </div>
      </div>
      {order > 0 && (
        <p className="whats-new__compare">
          your server runs {serverVersion} — this lists changes up to {newest.version}
        </p>
      )}
      {order < 0 && (
        <p className="whats-new__compare">
          your server runs {serverVersion} — the newest changes listed here are not in it yet
        </p>
      )}
      <div className="whats-new__body">
        {changelog.releases.map((release) => (
          <section key={release.version} className="whats-new__release">
            <span className="whats-new__release-head">
              v{release.version} · {release.date}
            </span>
            {release.sections.map((section) => (
              <div key={section.key} className="whats-new__section">
                <span className="whats-new__label mono-label">{section.key}</span>
                {section.entries.map((entry, index) => (
                  <p key={index} className="whats-new__entry">
                    {entry.breaking && <span className="whats-new__badge whats-new__badge--breaking">breaking</span>}
                    {entry.api && <span className="whats-new__badge whats-new__badge--api">api</span>}
                    {renderInlineCode(entry.text)}
                  </p>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="whats-new__footer">
        <button type="button" className="whats-new__close" onClick={onClose}>
          close
        </button>
      </div>
    </>
  )
}

/** What's-new dialog: a native `<dialog>` + `showModal()` (ESC and focus trap are native) around `WhatsNewContent`. */
export function WhatsNewModal(props: WhatsNewProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // `open` guard: the second StrictMode run meets an already open dialog — showModal() would throw.
    if (!dialog.open) dialog.showModal()
    function handleClose(): void {
      onCloseRef.current()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog ref={dialogRef} className="whats-new" aria-labelledby="whats-new-title">
      <WhatsNewContent {...props} />
    </dialog>
  )
}
