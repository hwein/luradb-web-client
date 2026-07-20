import type { ReactNode } from 'react'
import { useState } from 'react'
import { NavLink } from 'react-router'
import { LogoMark } from '../brand/LogoMark'
import { useTheme } from '../theme'
import { AboutModal } from './AboutModal'
import './Rail.css'

interface RailRoute {
  path: string
  title: string
  icon: ReactNode
}

const ROUTES: RailRoute[] = [
  {
    path: '/sql',
    title: 'LuraSQL console',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 4l5 4-5 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    path: '/data',
    title: 'Data browser',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="12" height="3.4" rx="1" fill="currentColor" />
        <rect x="2" y="6.3" width="12" height="3.4" rx="1" fill="currentColor" opacity="0.65" />
        <rect x="2" y="10.6" width="12" height="3.4" rx="1" fill="currentColor" opacity="0.35" />
      </svg>
    ),
  },
  {
    path: '/rest',
    title: 'REST Explorer',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 5.5h9M8.5 2.5l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 10.5H5M7.5 7.5l-3 3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
      </svg>
    ),
  },
  {
    path: '/engines',
    title: 'Engines & jobs',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    path: '/admin',
    title: 'Admin',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 5h12M2 11h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="10" cy="5" r="2" fill="var(--panel)" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="6" cy="11" r="2" fill="var(--panel)" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    path: '/config',
    title: 'Configuration',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M8 1.8v2.2M8 12v2.2M1.8 8H4M12 8h2.2M3.6 3.6l1.6 1.6M10.8 10.8l1.6 1.6M12.4 3.6l-1.6 1.6M5.2 10.8l-1.6 1.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    path: '/docs',
    title: 'Docs',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 2.5h7l3 3V13.5H3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M5.5 8h5M5.5 10.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
]

export function Rail() {
  const { theme, toggle } = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <nav className="rail">
      <button type="button" className="rail__logo" title="about LuraDB Client" onClick={() => setAboutOpen(true)}>
        <LogoMark size={34} />
      </button>
      {ROUTES.map((route) => (
        <NavLink
          key={route.path}
          to={route.path}
          title={route.title}
          className={({ isActive }) => `rail__button${isActive ? ' rail__button--active' : ''}`}
        >
          {route.icon}
        </NavLink>
      ))}
      <div className="rail__spacer" />
      <button type="button" className="rail__theme" title="Toggle theme" onClick={toggle}>
        {theme.toUpperCase()}
      </button>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </nav>
  )
}
