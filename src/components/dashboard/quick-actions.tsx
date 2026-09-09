import { BarChart3, BookPlus, CalendarCheck, FilePlus, PencilLine, UserPlus, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface QuickAction {
  label: string
  icon: LucideIcon
  to: string
}

// เช็คชื่อ/สร้างงาน/กรอกคะแนน/สร้างรายวิชา all point at /teacher/subjects,
// NOT the old classroom-less /teacher/attendance, /teacher/grades,
// /teacher/assignments routes (those now just redirect here anyway — see
// attendance-redirect-page, grades-redirect-page, assignments-redirect-page)
// — attendance/grades/assignments are only ever taken from a specific
// subject+classroom's เช็คชื่อ/งาน/คะแนน tab, and "สร้างรายวิชา" itself lives
// on the Subjects list page, so this sends the teacher straight to the
// real entry point (where they then pick/create the exact subject +
// classroom) instead of bouncing through a deprecated redirect page or
// guessing context that isn't known yet — see the Dashboard Control
// Center report's Section 7 note.
const actions: QuickAction[] = [
  { label: 'เช็คชื่อ', icon: CalendarCheck, to: '/teacher/subjects' },
  { label: 'สร้างงาน', icon: FilePlus, to: '/teacher/subjects' },
  { label: 'กรอกคะแนน', icon: PencilLine, to: '/teacher/subjects' },
  { label: 'เพิ่มนักเรียน', icon: UserPlus, to: '/teacher/students' },
  { label: 'สร้างรายวิชา', icon: BookPlus, to: '/teacher/subjects' },
  { label: 'ดูรายงาน', icon: BarChart3, to: '/teacher/reports' },
]

export function QuickActions() {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            onClick={() => navigate(action.to)}
          >
            <action.icon className="size-4" />
            {action.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
