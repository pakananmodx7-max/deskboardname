import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AttendanceSummary } from '@/types/dashboard'

interface AttendanceOverviewProps {
  attendance: AttendanceSummary
}

const rows: { key: keyof Omit<AttendanceSummary, 'total'>; label: string; barClassName: string }[] = [
  { key: 'present', label: 'มาเรียน', barClassName: 'bg-success' },
  { key: 'late', label: 'สาย', barClassName: 'bg-warning' },
  { key: 'leave', label: 'ลา', barClassName: 'bg-primary' },
  { key: 'absent', label: 'ขาด', barClassName: 'bg-destructive' },
]

export function AttendanceOverview({ attendance }: AttendanceOverviewProps) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">ภาพรวมการเข้าเรียนวันนี้</CardTitle>
        {/* /teacher/subjects, not the old classroom-less /teacher/attendance
            route — attendance is only ever taken from a specific
            subject+classroom's เช็คชื่อ tab. */}
        <Button size="sm" onClick={() => navigate('/teacher/subjects')}>
          เช็คชื่อ
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const value = attendance[row.key]
          const percent = attendance.total > 0 ? (value / attendance.total) * 100 : 0
          return (
            <div key={row.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">{value}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${row.barClassName}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )
        })}

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">รวมทั้งหมด</span>
          <span className="font-semibold">{attendance.total} คน</span>
        </div>
      </CardContent>
    </Card>
  )
}
