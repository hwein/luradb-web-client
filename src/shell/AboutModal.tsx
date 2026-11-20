import { useEffect, useRef } from 'react'
import { LogoMark } from '../brand/LogoMark'
import './AboutModal.css'

// Direct [dependencies] of src-tauri/Cargo.toml (tauri-build is a build dependency, omitted on purpose); rarely changes, so no TOML parsing.
const RUST_DEPENDENCIES = ['serde', 'serde_json', 'tauri', 'tauri-plugin-http']

interface AboutContentProps {
  onClose: () => void
}

/** About dialog content without the <dialog> wrapper, so tests can mount it without `showModal()`. */
export function AboutContent({ onClose }: AboutContentProps) {
  return (
    <>
      <div className="about__head">
        <LogoMark size={28} />
        <div className="about__heading">
          <span id="about-title" className="about__name">
            LuraDB Client
          </span>
          <span className="about__version mono-data">v{__APP_VERSION__}</span>
        </div>
      </div>
      <div className="about__body selectable">
        <section className="about__section">
          <span className="about__label mono-label">license</span>
          <p className="about__text">
            Functional Source License 1.1, Apache-2.0 future license <span className="about__nowrap">(FSL-1.1-ALv2)</span>
          </p>
          <p className="about__text about__text--mut">© 2026 Heiko Wein</p>
        </section>
        <section className="about__section">
          <span className="about__label mono-label">third-party libraries</span>
          <div className="about__group">
            <span id="about-frontend-label" className="about__group-label">
              frontend
            </span>
            <ul className="about__list" aria-labelledby="about-frontend-label">
              {__APP_DEPENDENCIES__.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
          <div className="about__group">
            <span id="about-rust-label" className="about__group-label">
              desktop shell (rust)
            </span>
            <ul className="about__list" aria-labelledby="about-rust-label">
              {RUST_DEPENDENCIES.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
      <div className="about__footer">
        <button type="button" className="about__close" onClick={onClose}>
          close
        </button>
      </div>
    </>
  )
}

interface AboutModalProps {
  onClose: () => void
}

/** Native `<dialog>` + `showModal()` (ESC and focus trap built in) around `AboutContent`. */
export function AboutModal({ onClose }: AboutModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // `open` guard: the StrictMode second run meets an already open dialog; showModal() would throw
    // before the close listener is registered (ESC would do nothing).
    if (!dialog.open) dialog.showModal()
    function handleClose(): void {
      onCloseRef.current()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [])

  return (
    <dialog ref={dialogRef} className="about" aria-labelledby="about-title">
      <AboutContent onClose={onClose} />
    </dialog>
  )
}
