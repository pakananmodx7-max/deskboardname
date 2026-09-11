import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { AssignmentResourcesDisclosure } from '@/features/student-portal/assignment-resources-disclosure'
import { LessonResourcesList } from '@/features/student-portal/lesson-resources-list'
import { buildStudentAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getResourceCounts } from '@/services/assignment-resource-service'
import { getLessons } from '@/services/lesson-service'
import {
  computeAttendanceRate,
  computeMyGrades,
  getMyAssignments,
  getMyAttendance,
  getMySubjects,
  summarizeMyAttendance,
} from '@/services/student-portal-service'
import {
  deriveStudentFacingStatus,
  STUDENT_SUBMISSION_STATUS_BADGE_VARIANT,
  STUDENT_SUBMISSION_STATUS_LABEL,
} from '@/services/submission-service'
import type { Lesson } from '@/types/lesson'
import type { MyAssignment, MyAttendanceRecord, MySubject } from '@/types/student-portal'
import { BookOpen, CalendarCheck, ClipboardList, GraduationCap } from 'lucide-react'

const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  present: 'มา',
  late: 'สาย',
  leave: 'ลา',
  absent: 'ขาด',
}

type TabKey = 'overview' | 'lessons' | 'assignments' | 'grades' | 'attendance'

/** Exported so the exact tab set is unit-testable without rendering.
 * บทเรียน sits right after ภาพรวม — teacher-organized learning materials
 * (slides/videos/documents/links), completely separate from งาน
 * (assignments). See 0015_lessons.sql's scope note. */
export const STUDENT_SUBJECT_TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'lessons', label: 'บทเรียน' },
  { key: 'assignments', label: 'งาน' },
  { key: 'grades', label: 'คะแนน' },
  { key: 'attendance', label: 'การเข้าเรียน' },
]

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * /student/subjects/:subjectId — the Subject Workspace, the ONE academic
 * hub a student uses (there is no separate flat "งานของฉัน" page anymore
 * — see student-nav-items.ts). Everything here is scoped to exactly this
 * subject AND the caller's own data (RLS already guarantees the latter).
 * No classroom roster, no classmates, no other student's assignment/
 * attendance/grade — only ever this student's own rows.
 *
 * PAGE ERROR ISOLATION: identity (which subject this is), assignments
 * (which also drives "งาน" and "คะแนน" — there is no separate grades
 * query; a grade is always score/max_score read straight off the same
 * assignment_submissions-derived MyAssignment row, via computeMyGrades),
 * and attendance each load and fail INDEPENDENTLY, each with its own
 * loading/error state. A failure in one never blanks the others: if
 * attendance fails, ภาพรวม/งาน/คะแนน still render (the overview's
 * attendance stat shows its own inline error instead of a fabricated
 * "0%"); if assignments fails, ภาพรวม's other stats and การเข้าเรียน
 * still render. A resource-count fetch failure (0013) never blocks
 * assignment info either — resourceCounts always falls back to an empty
 * map on error (see the .catch below), so "no resources" and "resource
 * lookup failed" both simply render as "no toggle shown", never a
 * blocked assignment row. A real zero is never confused with a failed
 * query: every section below checks its own `xError` first and shows
 * that, rather than silently treating a caught error as empty data.
 */
export function StudentSubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const [subject, setSubject] = useState<MySubject | null | undefined>(undefined)
  const [subjectLoading, setSubjectLoading] = useState(true)
  const [subjectError, setSubjectError] = useState<string | null>(null)

  const [lessons, setLessons] = useState<Lesson[]>([])
  const [lessonsLoading, setLessonsLoading] = useState(true)
  const [lessonsError, setLessonsError] = useState<string | null>(null)

  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({})
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null)

  const [attendance, setAttendance] = useState<MyAttendanceRecord[]>([])
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId) return
    let active = true
    setSubjectLoading(true)
    setSubjectError(null)
    getMySubjects()
      .then((subjects) => {
        if (active) setSubject(subjects.find((s) => s.id === subjectId) ?? null)
      })
      .catch((err: unknown) => {
        if (active) setSubjectError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setSubjectLoading(false)
      })
    return () => {
      active = false
    }
  }, [subjectId])

  const loadLessons = useCallback((classroomId: string) => {
    if (!subjectId) return undefined
    let active = true
    setLessonsLoading(true)
    setLessonsError(null)
    // RLS (`lessons_select_student`, 0015) already restricts this to
    // published, non-archived lessons in this student's own classroom —
    // no extra filtering needed client-side.
    getLessons(subjectId, classroomId)
      .then((rows) => {
        if (active) setLessons(rows)
      })
      .catch((err: unknown) => {
        if (active) setLessonsError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLessonsLoading(false)
      })
    return () => {
      active = false
    }
  }, [subjectId])

  const loadAssignments = useCallback(
    (classroomId: string) => {
      if (!subjectId) return undefined
      let active = true
      setAssignmentsLoading(true)
      setAssignmentsError(null)
      getMyAssignments(subjectId, classroomId)
        .then(async (rows) => {
          if (!active) return
          setAssignments(rows)
          // Best-effort enrichment only — a resource-count lookup failure
          // must never block the assignment rows themselves from
          // rendering, so it always falls back to an empty map rather
          // than propagating into assignmentsError.
          const counts = await getResourceCounts(rows.map((a) => a.id)).catch(() => ({}))
          if (active) setResourceCounts(counts)
        })
        .catch((err: unknown) => {
          if (active) setAssignmentsError(toFriendlyErrorMessage(err))
        })
        .finally(() => {
          if (active) setAssignmentsLoading(false)
        })
      return () => {
        active = false
      }
    },
    [subjectId],
  )

  const loadAttendance = useCallback(
    (classroomId: string) => {
      if (!subjectId) return undefined
      let active = true
      setAttendanceLoading(true)
      setAttendanceError(null)
      getMyAttendance(subjectId, classroomId)
        .then((rows) => {
          if (active) setAttendance(rows)
        })
        .catch((err: unknown) => {
          if (active) setAttendanceError(toFriendlyErrorMessage(err))
        })
        .finally(() => {
          if (active) setAttendanceLoading(false)
        })
      return () => {
        active = false
      }
    },
    [subjectId],
  )

  useEffect(() => {
    if (!subject) return
    const cleanupLessons = loadLessons(subject.classroomId)
    const cleanupAssignments = loadAssignments(subject.classroomId)
    const cleanupAttendance = loadAttendance(subject.classroomId)
    return () => {
      cleanupLessons?.()
      cleanupAssignments?.()
      cleanupAttendance?.()
    }
  }, [subject, loadLessons, loadAssignments, loadAttendance])

  if (!subjectId) return <Navigate to="/student/subjects" replace />
  if (subject === undefined || subjectLoading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }
  if (subjectError) return <p className="text-sm text-destructive">{subjectError}</p>
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
          {/* No teacher name here: a student has no RLS-granted read
              access to a teacher's profile row without 0012's
              profiles_select_my_teachers policy (not applied). Never
              fabricated — simply omitted until that's securely available. */}
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
          <StatCard
            label="งานที่ยังไม่ส่ง"
            value={assignmentsLoading ? '-' : assignmentsError ? 'ผิดพลาด' : `${pendingCount} งาน`}
            icon={ClipboardList}
          />
          <StatCard
            label="การเข้าเรียน"
            value={attendanceLoading ? '-' : attendanceError ? 'ผิดพลาด' : attendanceRate !== null ? `${attendanceRate.toFixed(0)}%` : '-'}
            helperText={attendanceError ?? (attendanceLoading ? undefined : `มา ${attendanceSummary.present} / ${attendanceSummary.total} ครั้ง`)}
            icon={CalendarCheck}
          />
          <StatCard
            label="คะแนนรวม"
            value={
              assignmentsLoading
                ? '-'
                : assignmentsError
                  ? 'ผิดพลาด'
                  : subjectGrade !== undefined && subjectGrade.percentage !== null
                    ? `${subjectGrade.percentage.toFixed(0)}%`
                    : '-'
            }
            helperText={subjectGrade && !assignmentsError ? `${subjectGrade.earned} / ${subjectGrade.possible} คะแนน` : undefined}
            icon={GraduationCap}
          />
          <StatCard
            label="งานทั้งหมด"
            value={assignmentsLoading ? '-' : assignmentsError ? 'ผิดพลาด' : `${assignments.length} งาน`}
            icon={BookOpen}
          />
        </div>
      )}

      {activeTab === 'lessons' && (
        <Card>
          <CardContent className="p-0">
            {lessonsLoading ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : lessonsError ? (
              <p className="px-5 py-6 text-center text-sm text-destructive">{lessonsError}</p>
            ) : lessons.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีบทเรียนที่เผยแพร่ในวิชานี้</p>
            ) : (
              <div className="divide-y divide-border">
                {lessons.map((lesson) => (
                  <div key={lesson.id} className="space-y-2 px-5 py-4">
                    <div>
                      <p className="text-sm font-medium">{lesson.title}</p>
                      {lesson.description && <p className="mt-0.5 text-xs text-muted-foreground">{lesson.description}</p>}
                    </div>
                    <LessonResourcesList lessonId={lesson.id} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'assignments' && (
        <Card>
          <CardContent className="p-0">
            {assignmentsLoading ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : assignmentsError ? (
              <p className="px-5 py-6 text-center text-sm text-destructive">{assignmentsError}</p>
            ) : assignments.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีงานในวิชานี้</p>
            ) : (
              <div className="divide-y divide-border">
                {assignments.map((a) => {
                  const status = deriveStudentFacingStatus(a)
                  return (
                    <div key={a.id} className="px-5 py-3">
                      <Link
                        to={buildStudentAssignmentDetailPath(a.subjectId, a.id)}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.title}</p>
                          {a.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.description}</p>}
                          <p className="text-xs text-muted-foreground">
                            กำหนดส่ง {a.dueDate ? formatDate(a.dueDate) : 'ไม่มีกำหนดส่ง'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{a.score !== null ? `${a.score}/${a.maxScore}` : `-/${a.maxScore}`}</span>
                          <Badge variant={STUDENT_SUBMISSION_STATUS_BADGE_VARIANT[status]}>{STUDENT_SUBMISSION_STATUS_LABEL[status]}</Badge>
                        </div>
                      </Link>
                      <AssignmentResourcesDisclosure assignmentId={a.id} resourceCount={resourceCounts[a.id] ?? 0} />
                    </div>
                  )
                })}
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
            {assignmentsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : assignmentsError ? (
              <p className="py-6 text-center text-sm text-destructive">{assignmentsError}</p>
            ) : !subjectGrade || subjectGrade.assignments.length === 0 ? (
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
            {attendanceLoading ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : attendanceError ? (
              <p className="px-5 py-6 text-center text-sm text-destructive">{attendanceError}</p>
            ) : attendance.length === 0 ? (
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
