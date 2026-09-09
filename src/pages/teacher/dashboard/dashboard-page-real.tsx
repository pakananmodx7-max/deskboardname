import { BookOpen, School, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { AttendanceOverview } from '@/components/dashboard/attendance-overview'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { StatCard } from '@/components/dashboard/stat-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getClassroomsWithStudentCounts,
  getDashboardOverview,
  getTodayAttendanceOverview,
  type ClassroomWithStudentCount,
  type DashboardOverview,
} from '@/services/dashboard-service'
import { toFriendlyErrorMessage } from '@/lib/errors'
import type { AttendanceSummary } from '@/types/attendance'

/**
 * /teacher/dashboard — real Supabase data only. Every number here comes
 * from a query scoped by this schema's existing RLS (teacher_id =
 * auth.uid(), or transitively through classroom ownership) — nothing is
 * fabricated. AI Assistant, Integrations status, and a "recent
 * activity"/"at-risk students" feed are deliberately NOT included here:
 * none of them have a real backing data source yet (no activity log
 * table, no risk-scoring logic, no configured integration), and building
 * one is out of scope for this pass — see docs/DATABASE.md and the
 * teacher-production-readiness report for the reasoning. Each section
 * below loads and fails independently so one slow/failed piece (e.g.
 * today's attendance, which fans out one request per classroom) never
 * blanks the whole page.
 */
export function DashboardPageReal() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const [classrooms, setClassrooms] = useState<ClassroomWithStudentCount[]>([])
  const [classroomsLoading, setClassroomsLoading] = useState(true)
  const [classroomsError, setClassroomsError] = useState<string | null>(null)

  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)

  const loadOverview = useCallback(() => {
    setOverviewLoading(true)
    setOverviewError(null)
    return getDashboardOverview()
      .then(setOverview)
      .catch((err: unknown) => setOverviewError(toFriendlyErrorMessage(err)))
      .finally(() => setOverviewLoading(false))
  }, [])

  const loadClassrooms = useCallback(() => {
    setClassroomsLoading(true)
    setClassroomsError(null)
    return getClassroomsWithStudentCounts()
      .then((rows) => {
        setClassrooms(rows)
        return rows
      })
      .catch((err: unknown) => {
        setClassroomsError(toFriendlyErrorMessage(err))
        return [] as ClassroomWithStudentCount[]
      })
      .finally(() => setClassroomsLoading(false))
  }, [])

  useEffect(() => {
    loadOverview()

    let active = true
    setAttendanceLoading(true)
    setAttendanceError(null)
    loadClassrooms()
      .then((rows) => (active ? getTodayAttendanceOverview(rows) : null))
      .then((summary) => {
        if (active && summary) setAttendance(summary)
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
  }, [loadOverview, loadClassrooms])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">ภาพรวม</h1>
        <p className="mt-1 text-sm text-muted-foreground">ภาคเรียนที่ 1 / 2569</p>
      </div>

      {overviewError && <p className="text-sm text-destructive">{overviewError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="ห้องเรียนทั้งหมด"
          value={overviewLoading ? '-' : `${overview?.activeClassroomCount ?? 0} ห้อง`}
          icon={School}
        />
        <StatCard
          label="นักเรียนทั้งหมด"
          value={overviewLoading ? '-' : `${overview?.studentCount ?? 0} คน`}
          icon={Users}
        />
        <StatCard
          label="รายวิชาทั้งหมด"
          value={overviewLoading ? '-' : `${overview?.subjectCount ?? 0} วิชา`}
          icon={BookOpen}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <QuickActions />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ห้องเรียนของฉัน</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {classroomsLoading ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
              ) : classroomsError ? (
                <p className="px-5 py-6 text-center text-sm text-destructive">{classroomsError}</p>
              ) : classrooms.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีห้องเรียน</p>
              ) : (
                <div className="divide-y divide-border">
                  {classrooms.map((classroom) => (
                    <Link
                      key={classroom.id}
                      to={`/teacher/classrooms/${classroom.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{classroom.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[classroom.gradeLevel, classroom.academicYear && `ปีการศึกษา ${classroom.academicYear}`]
                            .filter(Boolean)
                            .join(' · ') || '-'}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {classroom.studentCount} คน
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {attendanceLoading ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ภาพรวมการเข้าเรียนวันนี้</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
              </CardContent>
            </Card>
          ) : attendanceError ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ภาพรวมการเข้าเรียนวันนี้</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-destructive">{attendanceError}</p>
              </CardContent>
            </Card>
          ) : attendance && attendance.total > 0 ? (
            <AttendanceOverview attendance={attendance} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ภาพรวมการเข้าเรียนวันนี้</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">ยังไม่มีการเช็คชื่อวันนี้</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
