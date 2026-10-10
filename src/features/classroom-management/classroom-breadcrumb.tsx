import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

/** Where "back to my classrooms" goes now that the standalone list page
 * is part of the dashboard (/teacher/classrooms redirects here too). */
export const CLASSROOM_LIST_PATH = '/teacher/dashboard#classrooms'

/**
 * ภาพรวม › ห้องเรียนของฉัน › {classroom} — on a classroom's own page,
 * pointing back to the dashboard's classroom section (where the former
 * standalone classroom list now lives).
 */
export function ClassroomBreadcrumb({ classroomName }: { classroomName: string }) {
  return (
    <nav aria-label="เส้นทางนำทาง" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Link to="/teacher/dashboard" className="shrink-0 hover:text-primary hover:underline">
        ภาพรวม
      </Link>
      <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
      <Link to={CLASSROOM_LIST_PATH} className="shrink-0 hover:text-primary hover:underline">
        ห้องเรียนของฉัน
      </Link>
      <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate text-foreground" aria-current="page">
        {classroomName}
      </span>
    </nav>
  )
}
