import { GraduationCap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/** Exported as named constants (rather than inlined JSX text) so the
 * exact copy and redirect target are unit-testable without rendering —
 * see grades-redirect-page.test.ts. */
export const GRADES_REDIRECT_MESSAGE = 'กรุณาเลือกรายวิชาและห้องเรียนก่อน'
export const GRADES_REDIRECT_TARGET = '/teacher/subjects'

/**
 * What now lives at /teacher/grades — the old standalone, classroom-less
 * Grades workspace (grades-page.tsx) is no longer linked from the
 * sidebar or reachable as a real destination: grades are a derived view
 * over a specific subject+classroom's assignments and
 * assignment_submissions, never a bare classroom-less concept, so
 * they're managed from /teacher/subjects/:subjectId/classrooms/:classroomId's
 * คะแนน tab instead. This page exists only to catch anyone who still has
 * the old URL bookmarked or typed in directly. grades-page.tsx itself is
 * left in place, unreferenced, rather than deleted — same treatment as
 * the old assignments-page.tsx (see assignments-redirect-page.tsx).
 */
export function GradesRedirectPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <GraduationCap className="size-6" />
          </div>
          <p className="text-sm font-medium">{GRADES_REDIRECT_MESSAGE}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            คะแนนจะอยู่ภายในแต่ละห้องเรียนของรายวิชา — เลือกรายวิชาแล้วเลือกห้องเรียน จากนั้นเปิดแท็บ &ldquo;คะแนน&rdquo;
          </p>
          <Button type="button" onClick={() => navigate(GRADES_REDIRECT_TARGET)}>
            ไปที่รายวิชา
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
