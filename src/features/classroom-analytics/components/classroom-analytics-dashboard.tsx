import { CalendarDays, ClipboardCheck, School } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SEMESTER_SELECT_ID, SemesterSelect } from '@/features/semester/semester-select'
import { cn } from '@/lib/utils'

import {
  ALL_SEMESTERS,
  attendanceDateSpan,
  attendanceUnit,
  buildClassroomCards,
  buildTeacherInsights,
  cleanAttendanceRecords,
  computeAssignmentProgress,
  computeAttendanceBreakdown,
  computeRiskList,
  computeStudentAttendanceStats,
  computeSummary,
  computeWeeklyTrend,
  formatThaiShortDate,
  listSemesterOptions,
  rankHighestAttendance,
  rankMostAbsences,
  type AnalyticsAssignmentData,
  type AnalyticsAttendanceRecord,
  type AnalyticsContext,
  type AnalyticsRoster,
  type AttendanceUnit,
  type SemesterScope,
} from '../analytics'
import { combineResources, countValue, formatCount, LOADING, success, type Resource } from '../resource'
import { SectionError, SectionSkeleton } from './analytics-card'
import { AssignmentStatusCard, TeacherInsightsCard } from './assignment-insights'
import { AttendanceOverviewCard, MostAbsencesCard, RiskCard, TopAttendanceCard, WeeklyTrendCard, type StudentLinkBuilder } from './attendance-sections'
import { ClassroomSection } from './classroom-section'
import { DashboardBackdrop } from './dashboard-decor'
import { HeroClassN } from './hero-class-n'
import { SummaryCards } from './summary-cards'
import { WidgetBoundary } from './widget-boundary'

export interface ClassroomAnalyticsDashboardProps {
  /** Classrooms/subjects/links — shared with the header's semester selector. */
  context: Resource<AnalyticsContext>
  onRetryContext: () => void
  /** The selected semester (from the shared SemesterProvider); null while
   * the context loads. Every widget below reads this one value. */
  scope: SemesterScope | null
  roster: Resource<AnalyticsRoster>
  onRetryRoster: () => void
  attendance: Resource<AnalyticsAttendanceRecord[]>
  onRetryAttendance: () => void
  assignments: Resource<AnalyticsAssignmentData>
  onRetryAssignments: () => void
  teacherName: string
  /** Real mode: create/edit/archive classrooms with the existing dialogs. */
  classroomsEditable: boolean
  /** After a classroom was created/edited/archived/restored. */
  onClassroomsChanged: () => void
  /** Student Analytics link (real mode only). */
  studentLink?: StudentLinkBuilder
  /** YYYY-MM-DD — records after it are ignored; due dates compare to it. */
  today: string
}

function mapResource<T, U>(resource: Resource<T>, fn: (data: T) => U): Resource<U> {
  return resource.status === 'success' ? success(fn(resource.data)) : resource
}

function focusSemesterSelect() {
  const select = document.getElementById(SEMESTER_SELECT_ID) as HTMLSelectElement | null
  if (!select) return
  select.focus()
  try {
    select.showPicker?.()
  } catch {
    // showPicker needs a user gesture / is unsupported — focus is enough.
  }
}

function scopePhrase(scope: SemesterScope): string {
  return scope.key === ALL_SEMESTERS ? 'รวมทุกภาคเรียน' : `ใน${scope.label}`
}

/**
 * The unified teacher dashboard (หน้าภาพรวม) — replaces the former home,
 * classroom overview and classroom list pages. Layout + derivations only:
 * each widget renders from its own resource (one slow or failed request
 * never blanks another; pending shows a skeleton, never an empty state)
 * and sits in its own error boundary. All widgets, including the
 * classroom list at the bottom, follow the same selected semester.
 */
export function ClassroomAnalyticsDashboard(props: ClassroomAnalyticsDashboardProps) {
  const { context, scope, roster, attendance, assignments, today } = props
  const [trendClassroomId, setTrendClassroomId] = useState<string | null>(null)
  const [assignmentSubjectId, setAssignmentSubjectId] = useState<string | null>(null)

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

  // The subject filter only applies while that subject is in the semester.
  const effectiveAssignmentSubject = scope && assignmentSubjectId && scope.subjects.some((s) => s.id === assignmentSubjectId) ? assignmentSubjectId : null
  const progress = useMemo(
    () => (scope ? mapResource(combineResources(assignments, roster), ([a, r]) => computeAssignmentProgress(a, r, scope, today)) : LOADING),
    [assignments, roster, scope, today],
  ) as Resource<ReturnType<typeof computeAssignmentProgress>>
  const subjectProgress = useMemo(
    () =>
      scope && effectiveAssignmentSubject
        ? mapResource(combineResources(assignments, roster), ([a, r]) => computeAssignmentProgress(a, r, scope, today, effectiveAssignmentSubject))
        : progress,
    [scope, effectiveAssignmentSubject, assignments, roster, today, progress],
  )

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

  const classroomCards = useMemo(
    () => (scope && context.status === 'success' ? buildClassroomCards(context.data, scope, roster.status === 'success' ? roster.data : null) : null),
    [scope, context, roster],
  )

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
    <div className="relative isolate space-y-5">
      <DashboardBackdrop />
      <div className="kc-hero relative overflow-hidden rounded-3xl border px-5 py-5 shadow-soft sm:px-7 sm:py-7">
        <div className="relative flex items-center gap-4 sm:gap-5">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-card/85 text-3xl shadow-sm ring-1 ring-border/60 sm:size-16" aria-hidden="true">
            👋
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground max-sm:whitespace-normal sm:text-3xl">สวัสดี, {props.teacherName}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
              ภาพรวมห้องเรียน การเข้าเรียน และการส่งงานของคุณ{scope ? ` ${scopePhrase(scope)}` : ''}
            </p>
          </div>
          <HeroClassN />
        </div>
      </div>

      <SemesterInfoCard context={context} scope={scope} attendance={cleaned} />

      {context.status === 'error' ? (
        <SectionError message={context.error} onRetry={props.onRetryContext} />
      ) : !scope ? (
        <SectionSkeleton variant="block" />
      ) : (
        <>
          {scope.classrooms.length === 0 && (
            <p className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              ยังไม่มีห้องเรียนใน{scope.label} — เลือกภาคเรียนอื่นที่มุมขวาบน หรือกำหนดปีการศึกษา/ภาคเรียนให้ห้องเรียนในส่วน “ห้องเรียนของฉัน”
            </p>
          )}

          <WidgetBoundary title="สรุปภาพรวม">
            <SummaryCards
              students={summary ? countValue(summary.uniqueStudents, 'คน', `กำลังเรียน ${formatCount(summary.activeStudents)} คน (ไม่นับซ้ำ)`) : null}
              studentsError={roster.status === 'error'}
              classrooms={countValue(scope.classrooms.length, 'ห้อง', `ใช้งานอยู่ ${formatCount(scope.classrooms.filter((c) => c.isActive).length)} ห้อง`)}
              subjects={countValue(scope.subjects.length, 'วิชา', 'รวมทุกห้องเรียน')}
              assignments={
                assignments.status === 'success' && progress.status === 'success'
                  ? countValue(progress.data.assignmentCount, 'รายการ', `ยังไม่ถึงกำหนด ${formatCount(progress.data.openAssignmentCount)} รายการ`)
                  : null
              }
              assignmentsError={assignments.status === 'error'}
            />
          </WidgetBoundary>

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[1fr_1.3fr_1fr] [&>*]:min-w-0">
            <WidgetBoundary title="ภาพรวมการเข้าเรียน">
              <AttendanceOverviewCard resource={breakdown} unit={unit} onRetry={props.onRetryAttendance} />
            </WidgetBoundary>
            <WidgetBoundary title="แนวโน้มการเข้าเรียนรายสัปดาห์">
              <WeeklyTrendCard
                resource={weekly}
                classrooms={scope.classrooms}
                classroomId={effectiveTrendClassroom}
                onClassroomChange={setTrendClassroomId}
                onRetry={props.onRetryAttendance}
              />
            </WidgetBoundary>
            <div className="lg:col-span-2 2xl:col-span-1">
              <WidgetBoundary title="สถานะการส่งงาน">
                <AssignmentStatusCard
                  resource={subjectProgress}
                  onRetry={retryAssignmentSide}
                  subjects={scope.subjects}
                  subjectId={effectiveAssignmentSubject}
                  onSubjectChange={setAssignmentSubjectId}
                />
              </WidgetBoundary>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            <WidgetBoundary title="ขาดเรียนมากที่สุด">
              <MostAbsencesCard resource={mostAbsences} unit={unit} link={props.studentLink} onRetry={retryAttendanceSide} />
            </WidgetBoundary>
            <WidgetBoundary title="มาเรียนสม่ำเสมอ">
              <TopAttendanceCard resource={topAttendance} unit={unit} link={props.studentLink} onRetry={retryAttendanceSide} />
            </WidgetBoundary>
            <div className="lg:col-span-2 xl:col-span-1">
              <WidgetBoundary title="นักเรียนที่ต้องติดตาม">
                <RiskCard resource={risk} unit={unit} link={props.studentLink} onRetry={retryAttendanceSide} />
              </WidgetBoundary>
            </div>
          </div>

          <WidgetBoundary title="ข้อเสนอแนะสำหรับครู">
            <TeacherInsightsCard
              resource={insights}
              partial={insightsPartial}
              onRetry={() => {
                retryAttendanceSide()
                retryAssignmentSide()
              }}
            />
          </WidgetBoundary>
        </>
      )}

      {context.status !== 'error' && (
        <WidgetBoundary title="ห้องเรียนของฉัน">
          <ClassroomSection
            cards={classroomCards}
            countsReady={roster.status === 'success'}
            classroomRecords={context.status === 'success' ? context.data.classroomRecords : undefined}
            editable={props.classroomsEditable}
            scopeLabel={scope ? (scope.key === ALL_SEMESTERS ? 'ทุกภาคเรียน' : scope.label) : ''}
            scopeKey={scope?.key ?? null}
            onChanged={props.onClassroomsChanged}
          />
        </WidgetBoundary>
      )}
    </div>
  )
}

/** ภาคเรียนปัจจุบัน — what the dashboard is aggregating, from real data. */
function SemesterInfoCard({
  context,
  scope,
  attendance,
}: {
  context: Resource<AnalyticsContext>
  scope: SemesterScope | null
  attendance: Resource<AnalyticsAttendanceRecord[]>
}) {
  const semesterCount = context.status === 'success' ? listSemesterOptions(context.data).filter((o) => o.key !== ALL_SEMESTERS).length : 0
  const span = attendance.status === 'success' ? attendanceDateSpan(attendance.data) : null
  const isAll = scope?.key === ALL_SEMESTERS

  const attendanceStatus: { text: string; tone: 'ok' | 'muted' | 'error' } =
    attendance.status === 'loading'
      ? { text: 'กำลังโหลดช่วงวันที่เช็คชื่อ...', tone: 'muted' }
      : attendance.status === 'error'
        ? { text: 'โหลดช่วงวันที่เช็คชื่อไม่สำเร็จ', tone: 'error' }
        : span
          ? { text: `เช็คชื่อ ${formatThaiShortDate(span.first)} – ${formatThaiShortDate(span.last)}`, tone: 'ok' }
          : { text: 'ยังไม่มีบันทึกเช็คชื่อ', tone: 'muted' }

  return (
    <section aria-label="ภาคเรียนที่เลือก" className="relative overflow-hidden rounded-3xl border border-border/80 bg-card p-4 shadow-soft sm:p-5">
      <div className="flex items-center gap-4">
        <span className="kc-tone-blue kc-tone-chip flex size-12 shrink-0 items-center justify-center rounded-2xl sm:size-16">
          <CalendarDays className="size-6 sm:size-8" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{isAll ? 'ช่วงข้อมูลที่แสดง' : 'ภาคเรียนที่เลือก'}</p>
          {scope ? (
            <p className="truncate text-lg font-extrabold tracking-tight text-foreground sm:text-2xl">
              {isAll ? `ทุกภาคเรียน (รวม ${formatCount(semesterCount)} ภาคเรียน)` : scope.label}
            </p>
          ) : context.status === 'error' ? (
            <p className="text-sm text-destructive">โหลดภาคเรียนไม่สำเร็จ</p>
          ) : (
            <div className="mt-1 h-6 w-44 animate-pulse rounded-lg bg-muted" role="status" aria-label="กำลังโหลด" />
          )}
          {scope && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:text-sm">
              <span className="flex items-center gap-1.5">
                <School className="size-4 shrink-0" aria-hidden="true" />
                {formatCount(scope.classrooms.length)} ห้องเรียน · {formatCount(scope.subjects.length)} รายวิชา
              </span>
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
                  attendanceStatus.tone === 'ok' && 'bg-success/12 text-success',
                  attendanceStatus.tone === 'muted' && 'bg-muted text-muted-foreground',
                  attendanceStatus.tone === 'error' && 'bg-destructive/10 text-destructive',
                )}
              >
                <ClipboardCheck className="size-3.5 shrink-0" aria-hidden="true" />
                {attendanceStatus.text}
              </span>
            </div>
          )}
        </div>
        <Button type="button" onClick={focusSemesterSelect} disabled={!scope} className="hidden shrink-0 rounded-full px-5 shadow-sm sm:inline-flex">
          <CalendarDays className="size-4" />
          เปลี่ยนภาคเรียน
        </Button>
      </div>
      {/* The header selector is hidden on phones — same shared state here. */}
      <SemesterSelect id="dashboard-semester-select" className="mt-3 sm:hidden [&_select]:w-full [&_select]:max-w-none" />
    </section>
  )
}
