import { Download, LayoutDashboard } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { NativeSelect } from '@/components/ui/select'

import {
  attendanceUnit,
  buildTeacherInsights,
  cleanAttendanceRecords,
  computeAssignmentProgress,
  computeAttendanceBreakdown,
  computeRiskList,
  computeStudentAttendanceStats,
  computeSummary,
  computeWeeklyTrend,
  listSemesterOptions,
  rankHighestAttendance,
  rankMostAbsences,
  resolveSemesterScope,
  type AnalyticsAssignmentData,
  type AnalyticsAttendanceRecord,
  type AnalyticsContext,
  type AnalyticsRoster,
  type AttendanceUnit,
} from '../analytics'
import { combineResources, countValue, LOADING, success, type Resource } from '../resource'
import { SectionError, SectionSkeleton } from './analytics-card'
import { AssignmentStatusCard, TeacherInsightsCard } from './assignment-insights'
import { AttendanceOverviewCard, MostAbsencesCard, RiskCard, TopAttendanceCard, WeeklyTrendCard, type StudentLinkBuilder } from './attendance-sections'
import { SummaryCards } from './summary-cards'

export interface ClassroomAnalyticsDashboardProps {
  context: Resource<AnalyticsContext>
  onRetryContext: () => void
  semesterKey: string | null
  onSemesterChange: (key: string) => void
  roster: Resource<AnalyticsRoster>
  onRetryRoster: () => void
  attendance: Resource<AnalyticsAttendanceRecord[]>
  onRetryAttendance: () => void
  assignments: Resource<AnalyticsAssignmentData>
  onRetryAssignments: () => void
  /** Student Analytics link (real mode only). */
  studentLink?: StudentLinkBuilder
  /** YYYY-MM-DD — records after it are ignored; due dates compare to it. */
  today: string
}

function mapResource<T, U>(resource: Resource<T>, fn: (data: T) => U): Resource<U> {
  return resource.status === 'success' ? success(fn(resource.data)) : resource
}

/**
 * ระบบจัดการห้องเรียน → ภาพรวม — layout + derivations only. Each section
 * renders from its own resource, so one slow or failed request never
 * blanks another section, and a pending request shows a skeleton, never
 * an empty state.
 */
export function ClassroomAnalyticsDashboard(props: ClassroomAnalyticsDashboardProps) {
  const { context, semesterKey, roster, attendance, assignments, today } = props
  const [trendClassroomId, setTrendClassroomId] = useState<string | null>(null)

  const scope = useMemo(
    () => (context.status === 'success' && semesterKey ? resolveSemesterScope(context.data, semesterKey) : null),
    [context, semesterKey],
  )
  const semesterOptions = useMemo(() => (context.status === 'success' ? listSemesterOptions(context.data) : []), [context])

  const cleaned = useMemo(
    () => (scope ? mapResource(attendance, (records) => cleanAttendanceRecords(records, scope.classroomIds, today)) : LOADING),
    [attendance, scope, today],
  ) as Resource<AnalyticsAttendanceRecord[]>
  const unit: AttendanceUnit = cleaned.status === 'success' ? attendanceUnit(cleaned.data) : 'ครั้ง'

  const breakdown = useMemo(() => mapResource(cleaned, computeAttendanceBreakdown), [cleaned])
  const effectiveTrendClassroom = scope && trendClassroomId && scope.classroomIds.has(trendClassroomId) ? trendClassroomId : null
  const weekly = useMemo(() => mapResource(cleaned, (records) => computeWeeklyTrend(records, effectiveTrendClassroom)), [cleaned, effectiveTrendClassroom])

  const stats = useMemo(
    () =>
      scope && context.status === 'success'
        ? mapResource(combineResources(cleaned, roster), ([records, r]) => computeStudentAttendanceStats(records, r, scope, context.data.links))
        : LOADING,
    [cleaned, roster, scope, context],
  ) as Resource<ReturnType<typeof computeStudentAttendanceStats>>
  const mostAbsences = useMemo(() => mapResource(stats, (s) => rankMostAbsences(s)), [stats])
  const topAttendance = useMemo(() => mapResource(stats, (s) => rankHighestAttendance(s)), [stats])
  const risk = useMemo(() => mapResource(stats, (s) => computeRiskList(s, unit)), [stats, unit])

  const progress = useMemo(
    () => (scope ? mapResource(combineResources(assignments, roster), ([a, r]) => computeAssignmentProgress(a, r, scope, today)) : LOADING),
    [assignments, roster, scope, today],
  ) as Resource<ReturnType<typeof computeAssignmentProgress>>

  const insightParts = [breakdown, risk, progress]
  const insightsLoading = insightParts.some((r) => r.status === 'loading')
  const insightsFailedAll = insightParts.every((r) => r.status === 'error')
  const insights = useMemo(() => {
    if (!scope || insightsLoading) return LOADING
    if (insightsFailedAll) return { status: 'error', error: 'โหลดข้อมูลสำหรับข้อเสนอแนะไม่สำเร็จ' } as const
    const records = cleaned.status === 'success' ? cleaned.data : null
    return success(
      buildTeacherInsights({
        breakdown: breakdown.status === 'success' ? breakdown.data : null,
        weekly: records ? computeWeeklyTrend(records) : null,
        weeklyByClassroom: records ? scope.classrooms.map((classroom) => ({ classroom, points: computeWeeklyTrend(records, classroom.id) })) : null,
        risk: risk.status === 'success' ? risk.data : null,
        unit,
        assignments: progress.status === 'success' ? progress.data : null,
        classroomName: (id) => scope.classrooms.find((c) => c.id === id)?.name ?? '-',
      }),
    )
  }, [scope, insightsLoading, insightsFailedAll, cleaned, breakdown, risk, progress, unit])
  const insightsPartial = !insightsLoading && insightParts.some((r) => r.status === 'error')

  const retryAttendanceSide = () => {
    if (attendance.status === 'error') props.onRetryAttendance()
    if (roster.status === 'error') props.onRetryRoster()
  }
  const retryAssignmentSide = () => {
    if (assignments.status === 'error') props.onRetryAssignments()
    if (roster.status === 'error') props.onRetryRoster()
  }

  const summary = scope && roster.status === 'success' ? computeSummary(scope, roster.data) : null

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <LayoutDashboard className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">ภาพรวมการจัดการห้องเรียน</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              สรุปข้อมูลนักเรียน การเข้าเรียน และการส่งงานของคุณ{scope ? ` ใน${scope.label === 'ทุกภาคเรียน' ? 'ทุกภาคเรียน' : scope.label}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/teacher/reports"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-primary shadow-soft hover:bg-accent"
          >
            <Download className="size-4" />
            ส่งออกรายงาน
          </Link>
          <NativeSelect
            value={semesterKey ?? ''}
            onChange={(e) => props.onSemesterChange(e.target.value)}
            disabled={context.status !== 'success'}
            aria-label="เลือกภาคเรียน"
            className="h-9 w-auto min-w-44"
          >
            {context.status !== 'success' && <option value="">กำลังโหลดภาคเรียน...</option>}
            {semesterOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {context.status === 'error' ? (
        <SectionError message={context.error} onRetry={props.onRetryContext} />
      ) : !scope ? (
        <SectionSkeleton variant="block" />
      ) : (
        <>
          {scope.classrooms.length === 0 && (
            <p className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              ยังไม่มีห้องเรียนใน{scope.label} — เลือกภาคเรียนอื่น หรือกำหนดปีการศึกษา/ภาคเรียนให้ห้องเรียนในหน้าห้องเรียน
            </p>
          )}

          <SummaryCards
            students={summary ? countValue(summary.uniqueStudents, 'คน', `กำลังเรียน ${summary.activeStudents} คน (ไม่นับซ้ำ)`) : null}
            studentsError={roster.status === 'error'}
            classrooms={countValue(scope.classrooms.filter((c) => c.isActive).length, 'ห้อง', `ทั้งหมด ${scope.classrooms.length} ห้องในภาคเรียนนี้`)}
            subjects={countValue(scope.subjects.length, 'วิชา', 'รวมทุกห้องเรียน')}
            assignments={assignments.status === 'success' && progress.status === 'success' ? countValue(progress.data.assignmentCount, 'รายการ', `ยังไม่ถึงกำหนดส่ง ${progress.data.openAssignmentCount} รายการ`) : null}
            assignmentsError={assignments.status === 'error'}
          />

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[1fr_1.3fr_1fr] [&>*]:min-w-0">
            <AttendanceOverviewCard resource={breakdown} unit={unit} onRetry={props.onRetryAttendance} />
            <WeeklyTrendCard
              resource={weekly}
              classrooms={scope.classrooms}
              classroomId={effectiveTrendClassroom}
              onClassroomChange={setTrendClassroomId}
              onRetry={props.onRetryAttendance}
            />
            <div className="lg:col-span-2 2xl:col-span-1">
              <AssignmentStatusCard resource={progress} onRetry={retryAssignmentSide} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            <MostAbsencesCard resource={mostAbsences} unit={unit} link={props.studentLink} onRetry={retryAttendanceSide} />
            <TopAttendanceCard resource={topAttendance} unit={unit} link={props.studentLink} onRetry={retryAttendanceSide} />
            <div className="lg:col-span-2 xl:col-span-1">
              <RiskCard resource={risk} unit={unit} link={props.studentLink} onRetry={retryAttendanceSide} />
            </div>
          </div>

          <TeacherInsightsCard
            resource={insights}
            partial={insightsPartial}
            onRetry={() => {
              retryAttendanceSide()
              retryAssignmentSide()
            }}
          />
        </>
      )}
    </div>
  )
}
