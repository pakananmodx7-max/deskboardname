import { CalendarCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/** Exported as named constants (rather than inlined JSX text) so the
 * exact copy and redirect target are unit-testable without rendering —
 * see attendance-redirect-page.test.ts. */
export const ATTENDANCE_REDIRECT_MESSAGE = 'กรุณาเลือกรายวิชาและห้องเรียนก่อน'
export const ATTENDANCE_REDIRECT_TARGET = '/teacher/subjects'

/**
 * What now lives at /teacher/attendance — the standalone, top-level
 * Attendance page (attendance-page.tsx / attendance-page-real.tsx /
 * attendance-page-demo.tsx) is no longer linked from the sidebar or
 * reachable as a real destination: attendance is scoped to a specific
 * subject + classroom, so it's taken from
 * /teacher/subjects/:subjectId/classrooms/:classroomId's เช็คชื่อ tab
 * instead (which reuses the exact same attendance-service.ts and
 * AttendanceRosterCard this old page used — no duplicated mutation
 * path, only the entry point moved). This page exists only to catch
 * anyone who still has the old URL bookmarked or typed in directly,
 * matching the exact treatment already given to
 * assignments-redirect-page.tsx and grades-redirect-page.tsx.
 * attendance-page.tsx and its real/demo implementations are left in
 * place, unreferenced, rather than deleted — their backend
 * (attendance_sessions/attendance_records, save_attendance_session,
 * attendance-service.ts) is exactly what the เช็คชื่อ tab already runs
 * on, so nothing about the data layer changes.
 */
export function AttendanceRedirectPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarCheck className="size-6" />
          </div>
          <p className="text-sm font-medium">{ATTENDANCE_REDIRECT_MESSAGE}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            การเช็คชื่อจะอยู่ภายในแต่ละห้องเรียนของรายวิชา — เลือกรายวิชาแล้วเลือกห้องเรียน จากนั้นเปิดแท็บ &ldquo;เช็คชื่อ&rdquo;
          </p>
          <Button type="button" onClick={() => navigate(ATTENDANCE_REDIRECT_TARGET)}>
            ไปที่รายวิชา
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
