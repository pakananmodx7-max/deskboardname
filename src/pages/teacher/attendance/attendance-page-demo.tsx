import { Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { ATTENDANCE_STATUS_LABEL, ATTENDANCE_STATUS_ORDER } from '@/demo/attendance'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoAttendanceStatus } from '@/demo/types'
import { cn } from '@/lib/utils'

const statusButtonStyle: Record<DemoAttendanceStatus, string> = {
  present: 'data-[active=true]:bg-success data-[active=true]:text-success-foreground',
  late: 'data-[active=true]:bg-warning data-[active=true]:text-warning-foreground',
  leave: 'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
  absent: 'data-[active=true]:bg-destructive data-[active=true]:text-destructive-foreground',
}

const summaryDotStyle: Record<DemoAttendanceStatus, string> = {
  present: 'bg-success',
  late: 'bg-warning',
  leave: 'bg-primary',
  absent: 'bg-destructive',
}

export function AttendancePageDemo() {
  const { classroomName, students, attendance, attendanceSummary, setAttendanceStatus, saveAttendance } =
    useDemoClassroom()
  const { toast } = useToast()

  function handleSave() {
    saveAttendance()
    toast('บันทึกการเช็คชื่อเรียบร้อยแล้ว')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">เช็คชื่อนักเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">{classroomName} · วันนี้</p>
        </div>
        <Button onClick={handleSave}>
          <Save className="size-4" />
          บันทึกการเช็คชื่อ
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">สรุปการเข้าเรียน</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {ATTENDANCE_STATUS_ORDER.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <span className={cn('size-2.5 rounded-full', summaryDotStyle[status])} />
              <span className="text-muted-foreground">{ATTENDANCE_STATUS_LABEL[status]}</span>
              <span className="font-semibold">{attendanceSummary[status]}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
            <span className="text-muted-foreground">รวมทั้งหมด</span>
            <span className="font-semibold">{attendanceSummary.total} คน</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const current = attendance[student.id]
                  return (
                    <tr key={student.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                      <td className="px-5 py-3 font-medium">
                        {student.firstName} {student.lastName}
                        <span className="ml-1.5 text-xs text-muted-foreground">({student.nickname})</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {ATTENDANCE_STATUS_ORDER.map((status) => (
                            <button
                              key={status}
                              type="button"
                              data-active={current === status}
                              onClick={() => setAttendanceStatus(student.id, status)}
                              className={cn(
                                'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
                                statusButtonStyle[status],
                              )}
                            >
                              {ATTENDANCE_STATUS_LABEL[status]}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
