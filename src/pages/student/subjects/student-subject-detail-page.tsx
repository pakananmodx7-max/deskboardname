import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { AssignmentResourcesDisclosure } from '@/features/student-portal/assignment-resources-disclosure'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getResourceCounts } from '@/services/assignment-resource-service'
import {
  computeAttendanceRate,
  computeMyGrades,
  getMyAssignments,
  getMyAttendance,
  getMySubjects,
  summarizeMyAttendance,
} from '@/services/student-portal-service'
import type { MyAssignment, MyAttendanceRecord, MySubject } from '@/types/student-portal'
import { BookOpen, CalendarCheck, ClipboardList, GraduationCap } from 'lucide-react'

const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  present: 'มา',
  late: 'สาย',
  leave: 'ลา',
  absent: 'ขาด',
}

type TabKey = 'overview' | 'assignments' | 'grades' | 'attendance'

/** Exported so the exact tab set is unit-testable without rendering. */
export const STUDENT_SUBJECT_TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'assignments', label: 'งาน' },
  { key: 'grades', label: 'คะแนน' },
  { key: 'attendance', label: 'การเข้าเรียน' },
]

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * /student/subjects/:subjectId — everything here is scoped to exactly
 * this subject AND the caller's own data (RLS already guarantees the
 * latter; the classroom filter below narrows a subject linked to more
 * than one of the student's classrooms, which practically never
 * happens but is handled correctly regardless). No classroom roster, no
 * classmates, no other student's assignment/attendance/grade — only
 * ever this student's own rows.
 */
export function StudentSubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const [subject, setSubject] = useState<MySubject | null | undefined>(undefined)
  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({})
  const [attendance, setAttendance] = useState<MyAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId) return
    let active = true
    setLoading(true)
    setError(null)

    getMySubjects()
      .then(async (subjects) => {
        if (!active) return
        const found = subjects.find((s) => s.id === subjectId) ?? null
        setSubject(found)
        if (!found) return

        const [assignmentRows, attendanceRows] = await Promise.all([
          getMyAssignments(found.id, found.classroomId),
          getMyAttendance(found.id, found.classroomId),
        ])
        if (!active) return
        setAssignments(assignmentRows)
        setAttendance(attendanceRows)

        const counts = await getResourceCounts(assignmentRows.map((a) => a.id)).catch(() => ({}))
        if (active) setResourceCounts(counts)
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
  }, [subjectId])

  if (!subjectId) return <Navigate to="/student/subjects" replace />
  if (subject === undefined || loading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (subject === null) return <Navigate to="/student/subjects" replace />

  const attendanceSummary = summarizeMyAttendance(attendance)
  const attendanceRate = computeAttendanceRate(attendanceSummary)
  const grades = computeMyGrades(assignments)
  const subjectGrade = grades.bySubject[0]
  const pendingCount = assignments.filter((a) => a.status === 'not_submitted' || a.status === 'late').length

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="pt-1">
          <h1 className="text-xl font-semibold tracking-tight">{subject.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subject.classroomName}
            {subject.subjectCode ? ` · ${subject.subjectCode}` : ''}
          </p>
        </div>

        <div className="flex gap-1 overflow-x-auto">
          {STUDENT_SUBJECT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="งานที่ยังไม่ส่ง" value={`${pendingCount} งาน`} icon={ClipboardList} />
          <StatCard
            label="การเข้าเรียน"
            value={attendanceRate !== null ? `${attendanceRate.toFixed(0)}%` : '-'}
            helperText={`มา ${attendanceSummary.present} / ${attendanceSummary.total} ครั้ง`}
            icon={CalendarCheck}
          />
          <StatCard
            label="คะแนนรวม"
            value={
              subjectGrade !== undefined && subjectGrade.percentage !== null
                ? `${subjectGrade.percentage.toFixed(0)}%`
                : '-'
            }
            helperText={subjectGrade ? `${subjectGrade.earned} / ${subjectGrade.possible} คะแนน` : undefined}
            icon={GraduationCap}
          />
          <StatCard label="งานทั้งหมด" value={`${assignments.length} งาน`} icon={BookOpen} />
        </div>
      )}

      {activeTab === 'assignments' && (
        <Card>
          <CardContent className="p-0">
            {assignments.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีงานในวิชานี้</p>
            ) : (
              <div className="divide-y divide-border">
                {assignments.map((a) => (
                  <div key={a.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">
                          กำหนดส่ง {a.dueDate ? formatDate(a.dueDate) : 'ไม่มีกำหนดส่ง'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {a.score !== null && <span className="text-xs text-muted-foreground">{a.score}/{a.maxScore}</span>}
                        <Badge variant={a.status === 'submitted' ? 'success' : a.status === 'not_submitted' ? 'outline' : 'warning'}>
                          {SUBMISSION_STATUS_LABEL[a.status] ?? a.status}
                        </Badge>
                      </div>
                    </div>
                    <AssignmentResourcesDisclosure assignmentId={a.id} resourceCount={resourceCounts[a.id] ?? 0} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'grades' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">คะแนน</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!subjectGrade || subjectGrade.assignments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีคะแนนในวิชานี้</p>
            ) : (
              <>
                <div className="divide-y divide-border rounded-md border border-border">
                  {subjectGrade.assignments.map((row) => (
                    <div key={row.assignmentId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="truncate">{row.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {row.score !== null ? `${row.score}/${row.maxScore}` : `-/${row.maxScore}`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
                  <span className="text-muted-foreground">รวม</span>
                  <span className="font-semibold">
                    {subjectGrade.earned} / {subjectGrade.possible} คะแนน
                    {subjectGrade.percentage !== null && ` (${subjectGrade.percentage.toFixed(1)}%)`}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'attendance' && (
        <Card>
          <CardContent className="p-0">
            {attendance.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลการเข้าเรียน</p>
            ) : (
              <div className="divide-y divide-border">
                {attendance.map((record) => (
                  <div key={record.sessionId} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p>{formatDate(record.attendanceDate)}</p>
                      {record.periodNumber !== null && (
                        <p className="text-xs text-muted-foreground">คาบ {record.periodNumber}</p>
                      )}
                    </div>
                    <Badge variant={record.status === 'present' ? 'success' : record.status === 'absent' ? 'destructive' : 'warning'}>
                      {ATTENDANCE_STATUS_LABEL[record.status] ?? record.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
