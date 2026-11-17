import { Navigate, Route, Routes } from 'react-router'
import './AdminScreen.css'
import { IndexSection } from './IndexSection'

/** Admin-Container (spec admin/001 §1): heute nur der Index; eine künftige zweite Sektion (z. B. /admin/access) bringt ihre Subnav selbst mit. */
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
