import { useEffect, useRef } from 'react'
import { LogoMark } from '../brand/LogoMark'
import './AboutModal.css'

// src-tauri/Cargo.toml [dependencies] direkt ausgeliefert (tauri-build ist Build-Dependency, fehlt bewusst); änderungsarm ⇒ keine TOML-Parse-Automation.
const RUST_DEPENDENCIES = ['serde', 'serde_json', 'tauri', 'tauri-plugin-http']

interface AboutContentProps {
  onClose: () => void
}

/** Inhalt des About-Dialogs (spec shell/005) — ohne <dialog>-Hülle, damit Tests ihn ohne `showModal()` mounten können. */
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
      <div className="about__body">
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

/** About-Dialog (spec shell/005): natives `<dialog>` + `showModal()` (ESC/Fokus-Trap nativ) um `AboutContent`. */
export function AboutModal({ onClose }: AboutModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // `open`-Guard: der StrictMode-Zweitlauf trifft einen bereits offenen Dialog — showModal() würfe dann,
    // bevor der close-Listener registriert ist (ESC bliebe wirkungslos).
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
