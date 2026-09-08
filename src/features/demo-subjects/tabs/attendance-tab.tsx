import { Save } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { ATTENDANCE_STATUS_LABEL, ATTENDANCE_STATUS_ORDER } from '@/demo/attendance'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoAttendanceStatus, DemoSubject } from '@/demo/types'
import { cn } from '@/lib/utils'

interface AttendanceTabProps {
  subject: DemoSubject
  classroomId: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_RECORD: Record<string, DemoAttendanceStatus> = {}

const statusButtonStyle: Record<DemoAttendanceStatus, string> = {
  present: 'data-[active=true]:bg-success data-[active=true]:text-success-foreground',
  late: 'data-[active=true]:bg-warning data-[active=true]:text-warning-foreground',
  leave: 'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
  absent: 'data-[active=true]:bg-destructive data-[active=true]:text-destructive-foreground',
}

/**
 * Scoped to exactly one of the subject's linked classrooms — which
 * classroom is decided one level up, by the workspace's own classroom
 * switcher (see subject-classroom-workspace-page-demo.tsx), matching
 * subjects-real's AttendanceTab. subjectAttendance is keyed subjectId ->
 * classroomId -> date -> studentId (demo/types.ts), so saving here can
 * never be visible under, or overwrite, another linked classroom's roll
 * call for the same subject+date.
 */
export function AttendanceTab({ subject, classroomId }: AttendanceTabProps) {
  const { classrooms, allStudents, subjectAttendance, setSubjectAttendanceStatus, saveSubjectAttendance } =
    useDemoClassroom()
  const { toast } = useToast()
  const [date, setDate] = useState(todayIso)

  const students = getStudentsForClassrooms([classroomId], classrooms, allStudents).sort(
    (a, b) => a.number - b.number,
  )

  const recordForDate = subjectAttendance[subject.id]?.[classroomId]?.[date] ?? EMPTY_RECORD

  const statuses = useMemo(() => {
    const result: Record<string, DemoAttendanceStatus> = {}
    for (const student of students) {
      result[student.id] = recordForDate[student.id] ?? 'present'
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, recordForDate])

  const summary = useMemo(() => {
    const counts: Record<DemoAttendanceStatus, number> = { present: 0, late: 0, leave: 0, absent: 0 }
    for (const status of Object.values(statuses)) counts[status] += 1
    return counts
  }, [statuses])

  function handleSetStatus(studentId: string, status: DemoAttendanceStatus) {
    setSubjectAttendanceStatus(subject.id, classroomId, date, studentId, status)
  }

  function handleSave() {
    // Persist the resolved (default-included) status for every visible student,
    // not just the ones explicitly clicked, so the saved record is complete.
    for (const student of students) {
      setSubjectAttendanceStatus(subject.id, classroomId, date, student.id, statuses[student.id])
    }
    saveSubjectAttendance(subject.id, classroomId, date)
    toast('บันทึกการเช็คชื่อของรายวิชาเรียบร้อยแล้ว')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
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
              <span className="text-muted-foreground">{ATTENDANCE_STATUS_LABEL[status]}</span>
              <span className="font-semibold">{summary[status]}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
            <span className="text-muted-foreground">รวมทั้งหมด</span>
            <span className="font-semibold">{students.length} คน</span>
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
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : (
                  students.map((student) => {
                    const current = statuses[student.id]
                    return (
                      <tr key={student.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                        <td className="px-5 py-3 font-medium">
                          {student.firstName} {student.lastName}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {ATTENDANCE_STATUS_ORDER.map((status) => (
                              <button
                                key={status}
                                type="button"
                                data-active={current === status}
                                onClick={() => handleSetStatus(student.id, status)}
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
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
