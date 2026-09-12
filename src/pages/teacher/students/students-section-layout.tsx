import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { getLinkRequestsForTeacher } from '@/services/student-link-service'

const TABS = [
  { to: '/teacher/students', label: 'รายชื่อนักเรียน', end: true },
  { to: '/teacher/students/requests', label: 'คำขอเชื่อมบัญชี', end: false },
] as const

/**
 * Requirement 3: "คำขอเชื่อมบัญชีนักเรียน" removed from the global
 * sidebar and moved here as an in-page tab of Students, rather than a
 * sidebar sub-item — matching the "avoid unnecessary nested navigation"
 * design goal. The tab content itself (StudentsPage, StudentLinkRequestsPage)
 * is rendered via <Outlet/>, completely unchanged — same components,
 * same approve/reject/bulk-approve logic, same RLS-backed queries — this
 * layout only adds the tab bar and the pending-count badge around them.
 * The badge reuses getLinkRequestsForTeacher('pending') (the exact same
 * call StudentLinkRequestsPage itself makes) rather than a new endpoint
 * or a duplicated query.
 */
export function StudentsSectionLayout() {
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    getLinkRequestsForTeacher('pending')
      .then((rows) => {
        if (active) setPendingCount(rows.length)
      })
      .catch(() => {
        // Badge is a non-critical hint — if it can't be loaded, the tab
        // itself (StudentLinkRequestsPage) still loads and reports its
        // own error normally when the teacher clicks into it.
      })
    return () => {
      active = false
    }
    // Re-check whenever the teacher navigates back to this section (e.g.
    // after approving/rejecting requests and returning to the list).
  }, [location.pathname])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">นักเรียน</h1>
        <p className="mt-1 text-sm text-muted-foreground">รายชื่อนักเรียนและคำขอเชื่อมบัญชีจากผู้ปกครอง/นักเรียน</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {tab.label}
            {tab.to === '/teacher/students/requests' && pendingCount !== null && pendingCount > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {pendingCount}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
