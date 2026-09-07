import { CalendarCheck, FileUp, Plus, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface QuickAction {
  label: string
  icon: LucideIcon
  to: string
}

const actions: QuickAction[] = [
  { label: 'เช็คชื่อ', icon: CalendarCheck, to: '/teacher/attendance' },
  { label: 'เพิ่มคะแนน', icon: Plus, to: '/teacher/grades' },
  { label: 'เพิ่มงาน', icon: FileUp, to: '/teacher/assignments' },
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
