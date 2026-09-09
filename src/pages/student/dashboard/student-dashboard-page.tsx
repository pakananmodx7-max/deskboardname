import { CheckCircle2, Clock, ListTodo } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { StudentCalendarNotesCard } from '@/features/student-calendar/student-calendar-notes-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { useStudentNotificationsContext } from '@/lib/student-notifications-context'
import {
  getMyAssignments,
  getMyAttendance,
  getMyCalendarEntries,
  getMySubjects,
  getPendingAssignments,
  summarizeMyTodo,
} from '@/services/student-portal-service'
import type { MyAssignment, MyAttendanceRecord, MyCalendarEntry, MySubject } from '@/types/student-portal'

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

function formatNotificationTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * /student/dashboard — the student's daily home page. Every widget below
 * loads and fails INDEPENDENTLY (three separate pieces of state: core
 * academic data, calendar entries, and notifications via the shared
 * StudentNotificationsProvider) so one widget's error never blanks the
 * others — see Section K of the redesign spec. Real Supabase data only,
 * no demo fallback.
 */
export function StudentDashboardPage() {
  // Core academic data: subjects/assignments/attendance — same shape as
  // before the redesign, still used for the "งานของฉัน" summary + list.
  const [subjects, setSubjects] = useState<MySubject[]>([])
  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [attendance, setAttendance] = useState<MyAttendanceRecord[]>([])
  const [coreLoading, setCoreLoading] = useState(true)
  const [coreError, setCoreError] = useState<string | null>(null)

  // Calendar entries — independent widget, independent failure.
  const [calendarEntries, setCalendarEntries] = useState<MyCalendarEntry[]>([])
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [calendarError, setCalendarError] = useState<string | null>(null)

  // Notifications — shared with the header bell/toast via context, not
  // re-fetched here.
  const { notifications, loading: notificationsLoading, error: notificationsError, markRead } =
    useStudentNotificationsContext()

  useEffect(() => {
    let active = true
    setCoreLoading(true)
    setCoreError(null)

    Promise.all([getMySubjects(), getMyAssignments(), getMyAttendance()])
      .then(([subjectRows, assignmentRows, attendanceRows]) => {
        if (!active) return
        setSubjects(subjectRows)
        setAssignments(assignmentRows)
        setAttendance(attendanceRows)
      })
      .catch((err: unknown) => {
        if (active) setCoreError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setCoreLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setCalendarLoading(true)
    setCalendarError(null)

    getMyCalendarEntries()
      .then((rows) => {
        if (active) setCalendarEntries(rows)
      })
      .catch((err: unknown) => {
        if (active) setCalendarError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setCalendarLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  if (coreLoading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  if (coreError) {
    return <p className="text-sm text-destructive">{coreError}</p>
  }

  const todo = summarizeMyTodo(assignments)
  const pendingAssignments = getPendingAssignments(assignments)
  const recentNotifications = notifications.slice(0, 5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">หน้าหลัก</h1>
        <p className="mt-1 text-sm text-muted-foreground">ภาพรวมการเรียนของฉัน</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT / PRIMARY */}
        <div className="space-y-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">งานของฉัน</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="งานค้าง"
                value={`${todo.outstanding} งาน`}
                icon={ListTodo}
                tone={todo.outstanding > 0 ? 'warning' : 'default'}
              />
              <StatCard
                label="ใกล้กำหนด"
                value={`${todo.dueSoon} งาน`}
                icon={Clock}
                tone={todo.dueSoon > 0 ? 'warning' : 'default'}
              />
              <StatCard label="ส่งแล้ว" value={`${todo.submitted} งาน`} icon={CheckCircle2} tone="success" />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">งานที่ต้องทำ</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pendingAssignments.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">ไม่มีงานที่ต้องทำ</p>
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
                <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
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

        {/* RIGHT */}
        <div className="space-y-6">
          <StudentCalendarNotesCard
            loading={calendarLoading}
            error={calendarError}
            entries={calendarEntries}
            assignments={assignments}
            onEntriesChanged={setCalendarEntries}
          />

          <AttendanceGlanceCard attendance={attendance} />
        </div>
      </div>

      {/* BOTTOM */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อความจากครู</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {notificationsLoading ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
          ) : notificationsError ? (
            <p className="px-5 py-6 text-center text-sm text-destructive">{notificationsError}</p>
          ) : recentNotifications.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อความจากครู</p>
          ) : (
            <div className="divide-y divide-border">
              {recentNotifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n.id)}
                  className="block w-full px-5 py-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{n.senderName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatNotificationTime(n.createdAt)}</span>
                  </div>
                  {n.title && <p className="mt-0.5 text-xs font-medium text-muted-foreground">{n.title}</p>}
                  <p className="mt-1 truncate text-sm text-foreground">{n.message}</p>
                  {n.readAt === null && (
                    <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      ยังไม่ได้อ่าน
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Small at-a-glance attendance card for the RIGHT column — keeps the
 * previous dashboard's attendance visibility without a fourth top-level
 * stat card competing with the new "งานของฉัน" row. */
function AttendanceGlanceCard({ attendance }: { attendance: MyAttendanceRecord[] }) {
  const total = attendance.length
  const present = attendance.filter((r) => r.status === 'present').length
  const rate = total > 0 ? (present / total) * 100 : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">การเข้าเรียน</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{rate !== null ? `${rate.toFixed(0)}%` : '-'}</p>
        <p className="mt-1 text-xs text-muted-foreground">มา {present} / {total} ครั้ง</p>
      </CardContent>
    </Card>
  )
}
