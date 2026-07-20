import type { ReactElement } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router'
import './AdminScreen.css'
import { IndexSection } from './IndexSection'

interface AdminSection {
  path: string
  label: string
  element: ReactElement
}

// Sektions-Registry: künftiges Rechte-UI hängt sich mit { path: 'access', ... } an (admin/002, Grobkonzept §3).
const ADMIN_SECTIONS: AdminSection[] = [{ path: '', label: 'domains & auth', element: <IndexSection /> }]

function sectionHref(path: string): string {
  return path === '' ? '/admin' : `/admin/${path}`
}

/** Admin als Sektions-Container (spec admin/001 §1): heute nur der Index; Subnav bleibt bis zur zweiten Sektion unsichtbar. */
export function AdminScreen() {
  return (
    <div className="admin">
      {ADMIN_SECTIONS.length >= 2 && (
        <nav className="admin__subnav">
          {ADMIN_SECTIONS.map((section) => (
            <NavLink
              key={section.path}
              to={sectionHref(section.path)}
              end={section.path === ''}
              className={({ isActive }) => `admin__subnav-tab${isActive ? ' admin__subnav-tab--active' : ''}`}
            >
              {section.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Routes>
        {ADMIN_SECTIONS.map((section) =>
          section.path === '' ? (
            <Route key="index" index element={section.element} />
          ) : (
            <Route key={section.path} path={section.path} element={section.element} />
          ),
        )}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  )
}
