import { Navigate, Route, Routes } from 'react-router'
import './AdminScreen.css'
import { IndexSection } from './IndexSection'

/** Admin container: only the index today; a future second section (e.g. /admin/access) brings its own subnav. */
export function AdminScreen() {
  return (
    <div className="admin">
      <Routes>
        <Route index element={<IndexSection />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  )
}
