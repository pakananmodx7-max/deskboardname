import { CalendarCheck, FileUp, Plus, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface QuickAction {
  label: string
  icon: LucideIcon
  to: string
}

// เช็คชื่อ/เพิ่มคะแนน/เพิ่มงาน all point at /teacher/subjects, NOT the old
// classroom-less /teacher/attendance, /teacher/grades, /teacher/assignments
// routes (those now just redirect here anyway — see attendance-redirect-page,
// grades-redirect-page, assignments-redirect-page) — attendance/grades/
// assignments are only ever taken from a specific subject+classroom's
// เช็คชื่อ/คะแนน/งาน tab, so this sends the teacher straight to the real
// entry point instead of bouncing through a deprecated redirect page first.
const actions: QuickAction[] = [
  { label: 'เช็คชื่อ', icon: CalendarCheck, to: '/teacher/subjects' },
  { label: 'เพิ่มคะแนน', icon: Plus, to: '/teacher/subjects' },
  { label: 'เพิ่มงาน', icon: FileUp, to: '/teacher/subjects' },
  { label: 'สร้างรายงาน', icon: Sparkles, to: '/teacher/reports' },
  { label: 'Import นักเรียน', icon: Upload, to: '/teacher/students' },
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
