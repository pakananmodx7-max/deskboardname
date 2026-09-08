import { ClipboardList } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/** Exported as named constants (rather than inlined JSX text) so the
 * exact copy and redirect target are unit-testable without rendering —
 * see assignments-redirect-page.test.ts. */
export const ASSIGNMENTS_REDIRECT_MESSAGE = 'กรุณาเลือกรายวิชาและห้องเรียนก่อน'
export const ASSIGNMENTS_REDIRECT_TARGET = '/teacher/subjects'

/**
 * What now lives at /teacher/assignments — the old standalone,
 * classroom-less Assignments workspace (assignments-page.tsx) is no
 * longer linked from the sidebar or reachable as a real destination:
 * an assignment always belongs to a specific subject + classroom, so
 * it's managed from /teacher/subjects/:subjectId/classrooms/:classroomId's
 * งาน tab instead. This page exists only to catch anyone who still has
 * the old URL bookmarked or typed in directly, and point them at the
 * right starting point rather than 404ing or silently showing the old
 * (never classroom-scoped) workspace. assignments-page.tsx itself is
 * left in place, unreferenced, rather than deleted — see the demo
 * AssignmentsTab/AssignmentDialog it shares data plumbing with, which
 * ARE still reused (adapted for classroom scoping) by the new งาน tab.
 */
export function AssignmentsRedirectPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ClipboardList className="size-6" />
          </div>
          <p className="text-sm font-medium">{ASSIGNMENTS_REDIRECT_MESSAGE}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            งานที่มอบหมายจะอยู่ภายในแต่ละห้องเรียนของรายวิชา — เลือกรายวิชาแล้วเลือกห้องเรียน จากนั้นเปิดแท็บ &ldquo;งาน&rdquo;
          </p>
          <Button type="button" onClick={() => navigate(ASSIGNMENTS_REDIRECT_TARGET)}>
            ไปที่รายวิชา
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
