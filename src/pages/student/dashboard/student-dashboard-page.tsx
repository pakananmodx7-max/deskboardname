import { BookOpen, CalendarCheck, ClipboardList, GraduationCap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  computeAttendanceRate,
  computeMyGrades,
  getMyAssignments,
  getMyAttendance,
  getMySubjects,
  getPendingAssignments,
  summarizeMyAttendance,
} from '@/services/student-portal-service'
import type { MyAssignment, MyAttendanceRecord, MySubject } from '@/types/student-portal'

const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'ไม่มีกำหนดส่ง'
  return new Date(dueDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * /student/dashboard — real Supabase data only, no demo fallback. Every
 * fetch below (getMySubjects/getMyAssignments/getMyAttendance) reads
 * exclusively through 0011's RLS policies, scoped server-side to the
 * signed-in student's own approved link — see student-portal-service.ts.
 */
export function StudentDashboardPage() {
  const [subjects, setSubjects] = useState<MySubject[]>([])
  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [attendance, setAttendance] = useState<MyAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    Promise.all([getMySubjects(), getMyAssignments(), getMyAttendance()])
      .then(([subjectRows, assignmentRows, attendanceRows]) => {
        if (!active) return
        setSubjects(subjectRows)
        setAssignments(assignmentRows)
        setAttendance(attendanceRows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  const attendanceSummary = summarizeMyAttendance(attendance)
  const attendanceRate = computeAttendanceRate(attendanceSummary)
  const grades = computeMyGrades(assignments)
  const pendingAssignments = getPendingAssignments(assignments)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">หน้าหลัก</h1>
        <p className="mt-1 text-sm text-muted-foreground">ภาพรวมการเรียนของฉัน</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="งานที่ยังไม่ส่ง"
          value={`${pendingAssignments.length} งาน`}
          icon={ClipboardList}
          tone={pendingAssignments.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="การเข้าเรียน"
          value={attendanceRate !== null ? `${attendanceRate.toFixed(0)}%` : '-'}
          helperText={`มา ${attendanceSummary.present} / ${attendanceSummary.total} ครั้ง`}
          icon={CalendarCheck}
          tone="success"
        />
        <StatCard
          label="คะแนนรวม"
          value={grades.totalPercentage !== null ? `${grades.totalPercentage.toFixed(0)}%` : '-'}
          helperText={`${grades.totalEarned} / ${grades.totalPossible} คะแนน`}
          icon={GraduationCap}
        />
        <StatCard label="รายวิชาของฉัน" value={`${subjects.length} วิชา`} icon={BookOpen} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">งานที่ต้องทำ</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pendingAssignments.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">ไม่มีงานที่ต้องทำในตอนนี้</p>
          ) : (
            <div className="divide-y divide-border">
              {pendingAssignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.subjectName} · กำหนดส่ง {formatDueDate(a.dueDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.score !== null && <span className="text-xs text-muted-foreground">{a.score}/{a.maxScore}</span>}
                    <Badge variant={a.status === 'late' ? 'warning' : 'outline'}>
                      {SUBMISSION_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายวิชาของฉัน</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {subjects.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีรายวิชา</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((subject) => {
                const pendingCount = pendingAssignments.filter((a) => a.subjectId === subject.id).length
                return (
                  <Link key={`${subject.id}:${subject.classroomId}`} to={`/student/subjects/${subject.id}`}>
                    <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
                      <CardContent className="space-y-1.5 pt-5">
                        <p className="text-sm font-medium">{subject.name}</p>
                        <p className="text-xs text-muted-foreground">{subject.classroomName}</p>
                        {pendingCount > 0 && (
                          <Badge variant="warning" className="mt-1">
                            งานค้าง {pendingCount}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
