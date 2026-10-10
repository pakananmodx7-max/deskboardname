import { AlertTriangle, BarChart3, Briefcase, CalendarDays, CircleCheck, CircleX, Clock, Download, ExternalLink, FileText, Flag, Printer, RotateCw, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import type * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { todayIso } from '@/features/classroom-analytics/analytics'
import { WeeklyAttendanceChart } from '@/features/classroom-analytics/components/charts'
import { formatThaiDate } from '@/features/reports-missing/missing-report-model'
import { SemesterSelect } from '@/features/semester/semester-select'
import { useSemester } from '@/features/semester/semester-store'
import { buildStudentAnalyticsPath } from '@/features/subjects-shared/subject-classroom-nav'
import { dataMode } from '@/lib/data-mode'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { downloadAttendanceCsv, downloadAttendanceDocx, downloadAttendancePdf } from './attendance-report-exports'
import {
  BAND_FILTER_LABEL,
  BAND_LABEL,
  bandOf,
  buildAttendanceMeta,
  buildAttendanceReport,
  formatRate,
  PRESET_LABEL,
  STATUS_LABEL,
  VIEW_LABEL,
  type AttendanceReport,
  type AttendanceReportFilters,
  type AttendanceView,
  type BandFilter,
  type DatePreset,
} from './attendance-report-model'
import { attendanceFiltersFromParams, attendanceFiltersToParams, attendancePrintHref } from './attendance-report-params'
import { BAND_STYLE } from './attendance-report-styles'
import { AttendanceStudentTable } from './attendance-student-table'
import type { AttendanceReportData } from './use-attendance-report-data'

export interface AttendanceReportProps {
  useData: () => AttendanceReportData
  teacherName: string | null
}

type Busy = 'csv' | 'docx' | 'pdf' | null

/**
 * Reports → สรุปการเข้าเรียน. Four internal views (สรุปภาพรวม / รายห้องเรียน /
 * รายวิชา / รายนักเรียน) over ONE report built by buildAttendanceReport()
 * for the filters in the URL and the shared semester; the print preview
 * and PDF/Word/CSV exports use the same report object.
 */
export function AttendanceReport({ useData, teacherName }: AttendanceReportProps) {
  const { context, scope, retryContext } = useSemester()
  const { data, refresh } = useData()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => attendanceFiltersFromParams(searchParams), [searchParams])
  const [busy, setBusy] = useState<Busy>(null)
  const [classroomQuery, setClassroomQuery] = useState('')
  const today = todayIso()

  function update(patch: Partial<AttendanceReportFilters>) {
    setSearchParams((prev) => attendanceFiltersToParams({ ...filters, ...patch }, prev), { replace: true })
  }

  const report = useMemo(
    () =>
      context.status === 'success' && scope && data.status === 'success'
        ? buildAttendanceReport({ context: context.data, scope, roster: data.data[0], records: data.data[1], filters, today })
        : null,
    [context, scope, data, filters, today],
  )
  const meta = useMemo(
    () => (report && context.status === 'success' && scope ? buildAttendanceMeta({ context: context.data, scope, filters, report, teacherName, today }) : null),
    [report, context, scope, filters, teacherName, today],
  )

  const loading = context.status === 'loading' || !scope || data.status === 'loading'
  const error = context.status === 'error' ? context.error : data.status === 'error' ? data.error : null
  const resetKey = JSON.stringify({ ...filters, studentId: null, sort: null, direction: null, scope: scope?.key })

  async function runExport(kind: Exclude<Busy, null>) {
    if (!report || !meta) return
    setBusy(kind)
    try {
      if (kind === 'csv') downloadAttendanceCsv(report, meta)
      else if (kind === 'docx') await downloadAttendanceDocx(report, meta)
      else await downloadAttendancePdf(report, meta)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ส่งออกรายงานไม่สำเร็จ'))
    } finally {
      setBusy(null)
    }
  }

  const exportDisabled = !report || busy !== null || (filters.view === 'student' && !report.student)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <BarChart3 className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-foreground">สรุปการเข้าเรียน</h2>
            <p className="text-sm text-muted-foreground">รายงานสถิติการเข้าเรียนของนักเรียน</p>
            <p className="text-xs text-muted-foreground">{meta ? `${meta.semesterLabel} · ${meta.classroomLabel} · ${meta.subjectLabel} · ${meta.periodLabel}` : 'กำลังโหลดขอบเขตรายงาน...'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RotateCw className={cn('size-4', loading && 'animate-spin')} />
            รีเฟรชข้อมูล
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => runExport('csv')} disabled={exportDisabled}>
            <Download className="size-4" />
            {busy === 'csv' ? 'กำลังส่งออก...' : 'CSV'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => runExport('docx')} disabled={exportDisabled}>
            <FileText className="size-4" />
            {busy === 'docx' ? 'กำลังสร้างไฟล์...' : 'Word (.docx)'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => runExport('pdf')} disabled={exportDisabled}>
            <Download className="size-4" />
            {busy === 'pdf' ? 'กำลังสร้าง PDF...' : 'PDF'}
          </Button>
          <Button asChild size="sm">
            <Link to={attendancePrintHref(filters)}>
              <Printer className="size-4" />
              พิมพ์ (A4)
            </Link>
          </Button>
        </div>
      </div>

      {/* Internal attendance views (not top-level report tabs) */}
      <div role="tablist" aria-label="มุมมองรายงานการเข้าเรียน" className="flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
        {(Object.keys(VIEW_LABEL) as AttendanceView[]).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={filters.view === view}
            onClick={() => update({ view })}
            className={cn(
              'shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              filters.view === view ? 'bg-card text-primary shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {VIEW_LABEL[view]}
          </button>
        ))}
      </div>

      <SummaryCards report={report} />

      {/* Filters */}
      <section aria-label="ตัวกรองรายงานการเข้าเรียน" className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft sm:grid-cols-2 lg:grid-cols-4">
        <Field label="ภาคเรียน">
          <SemesterSelect id="attendance-report-semester" className="[&_select]:w-full [&_select]:max-w-none" />
        </Field>
        {filters.view !== 'classroom' && (
          <Field label="ห้องเรียน">
            <NativeSelect value={filters.classroomId ?? ''} onChange={(e) => update({ classroomId: e.target.value || null, studentId: null })} aria-label="ห้องเรียน" className="h-9 w-full">
              <option value="">ทุกห้องเรียน</option>
              {(scope?.classrooms ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="รายวิชา">
          <NativeSelect value={filters.subjectId ?? ''} onChange={(e) => update({ subjectId: e.target.value || null })} aria-label="รายวิชา" className="h-9 w-full">
            <option value="">{filters.view === 'subject' ? 'เลือกรายวิชา...' : 'ทุกรายวิชา (รวมเช็คชื่อประจำวัน)'}</option>
            {(scope?.subjects ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="ช่วงวันที่">
          <NativeSelect value={filters.preset} onChange={(e) => update({ preset: e.target.value as DatePreset })} aria-label="ช่วงวันที่" className="h-9 w-full">
            {(Object.keys(PRESET_LABEL) as DatePreset[]).map((p) => (
              <option key={p} value={p}>
                {PRESET_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {filters.preset === 'custom' && (
          <>
            <Field label="ตั้งแต่วันที่">
              <input type="date" value={filters.from ?? ''} max={filters.to ?? today} onChange={(e) => update({ from: e.target.value || null })} aria-label="ตั้งแต่วันที่" className={INPUT} />
            </Field>
            <Field label="ถึงวันที่">
              <input type="date" value={filters.to ?? ''} min={filters.from ?? undefined} max={today} onChange={(e) => update({ to: e.target.value || null })} aria-label="ถึงวันที่" className={INPUT} />
            </Field>
          </>
        )}
        <Field label="สถานะการเข้าเรียน">
          <NativeSelect value={filters.band} onChange={(e) => update({ band: e.target.value as BandFilter })} aria-label="สถานะการเข้าเรียน" className="h-9 w-full">
            {(Object.keys(BAND_FILTER_LABEL) as BandFilter[]).map((b) => (
              <option key={b} value={b}>
                {BAND_FILTER_LABEL[b]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="ค้นหานักเรียน" className={SEARCH_SPAN[searchSpan(filters)]}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" value={filters.search} onChange={(e) => update({ search: e.target.value })} placeholder="ชื่อ นามสกุล เลขที่ หรือรหัสนักเรียน..." aria-label="ค้นหานักเรียน" className={cn(INPUT, 'pl-9')} />
          </div>
        </Field>
      </section>

      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-card p-10 text-center">
          <AlertTriangle className="size-6 text-destructive" />
          <p className="text-sm text-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={context.status === 'error' ? retryContext : refresh}>
            <RotateCw className="size-4" />
            ลองใหม่
          </Button>
        </div>
      ) : loading || !report ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4" role="status" aria-label="กำลังโหลดรายงาน" data-testid="attendance-report-loading">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : scope && scope.classrooms.length === 0 ? (
        <Empty title={`ยังไม่มีห้องเรียนใน${scope.label}`} hint="เลือกภาคเรียนอื่นจากตัวเลือกด้านบน" />
      ) : filters.view === 'classroom' ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr] [&>*]:min-w-0">
          <ClassroomPanel report={report} selectedId={filters.classroomId} query={classroomQuery} onQuery={setClassroomQuery} onSelect={(classroomId) => update({ classroomId, studentId: null })} />
          <div className="space-y-4">
            {report.classroomDetail && <ClassroomDetails report={report} semesterLabel={scope?.label ?? ''} />}
            <StudentSection report={report} filters={filters} update={update} resetKey={resetKey} />
          </div>
        </div>
      ) : filters.view === 'subject' && !filters.subjectId ? (
        <Empty title="เลือกรายวิชาเพื่อดูสถิติการเข้าเรียนรายวิชา" hint="ใช้ตัวเลือก “รายวิชา” ด้านบน — การเช็คชื่อประจำวัน (ไม่ระบุวิชา) จะไม่นับในมุมมองนี้" />
      ) : filters.view === 'student' ? (
        <StudentView report={report} filters={filters} update={update} />
      ) : (
        <div className="space-y-4">
          {filters.view === 'subject' && <SubjectBreakdown report={report} />}
          <StudentSection report={report} filters={filters} update={update} resetKey={resetKey} />
        </div>
      )}
    </div>
  )
}

/** The search box fills the rest of the last filter row (4 columns). */
function searchSpan(filters: AttendanceReportFilters): 1 | 2 | 3 | 4 {
  const before = 1 + (filters.view !== 'classroom' ? 1 : 0) + 1 + 1 + (filters.preset === 'custom' ? 2 : 0) + 1
  return (4 - (before % 4) || 4) as 1 | 2 | 3 | 4
}

const SEARCH_SPAN = { 1: 'sm:col-span-2 lg:col-span-1', 2: 'sm:col-span-2 lg:col-span-2', 3: 'sm:col-span-2 lg:col-span-3', 4: 'sm:col-span-2 lg:col-span-4' } as const

const INPUT =
  'h-9 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function SummaryCards({ report }: { report: AttendanceReport | null }) {
  const s = report?.summary
  const pct = (n: number) => (s && s.total > 0 ? `${((n / s.total) * 100).toFixed(1)}%` : null)
  const cards: { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; value: string | null; hint: string | null }[] = [
    { label: 'นักเรียนทั้งหมด', icon: Users, tone: 'bg-primary/12 text-primary', value: s ? `${s.uniqueStudents} คน` : null, hint: s ? (s.studentsWithoutRecords ? `ไม่นับซ้ำ · ยังไม่มีข้อมูล ${s.studentsWithoutRecords} คน` : 'ไม่นับซ้ำ') : null },
    { label: 'มาเรียน', icon: CircleCheck, tone: 'bg-success/15 text-success', value: s ? `${s.present} ครั้ง` : null, hint: s ? pct(s.present) : null },
    { label: 'มาสาย', icon: Clock, tone: 'bg-warning/20 text-orange-500', value: s ? `${s.late} ครั้ง` : null, hint: s ? pct(s.late) : null },
    { label: 'ลา', icon: Briefcase, tone: 'bg-violet-500/15 text-violet-500', value: s ? `${s.leave} ครั้ง` : null, hint: s ? pct(s.leave) : null },
    { label: 'ขาดเรียน', icon: CircleX, tone: 'bg-destructive/12 text-destructive', value: s ? `${s.absent} ครั้ง` : null, hint: s ? pct(s.absent) : null },
  ]
  return (
    <section aria-label="สรุปสถิติการเข้าเรียน" className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
            <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', card.tone)}>
              <card.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              {card.value === null ? (
                <div className="mt-1 h-6 w-16 animate-pulse rounded bg-muted" role="status" aria-label="กำลังโหลด" />
              ) : (
                <p className="text-xl font-bold tabular-nums text-foreground">{card.value}</p>
              )}
              {card.hint && <p className="truncate text-xs text-muted-foreground">{card.hint}</p>}
            </div>
          </div>
        ))}
      </div>
      {s && (
        <p className="text-xs text-muted-foreground">
          {s.total > 0
            ? `ร้อยละคิดจากรายการเช็คชื่อทั้งหมด ${s.total} รายการ (เช็คชื่อ ${s.sessions} ครั้ง) · อัตรามาเรียน = มาเรียน ÷ รายการเช็คชื่อ = ${formatRate(s.rate)} · นักเรียนที่ยังไม่ถูกเช็คชื่อไม่นับเป็นขาดเรียน`
            : 'ยังไม่มีข้อมูลการเช็คชื่อในช่วงที่เลือก'}
        </p>
      )}
    </section>
  )
}

function RatePill({ rate }: { rate: number | null }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', BAND_STYLE[bandOf(rate)].badge)}>{rate === null ? 'ไม่มีข้อมูล' : `${rate.toFixed(1)}%`}</span>
}

function ClassroomPanel({ report, selectedId, query, onQuery, onSelect }: { report: AttendanceReport; selectedId: string | null; query: string; onQuery: (q: string) => void; onSelect: (id: string | null) => void }) {
  const all = report.classrooms.reduce((acc, c) => ({ present: acc.present + c.present, total: acc.total + c.total, students: acc.students + c.students }), { present: 0, total: 0, students: 0 })
  const q = query.trim().toLowerCase()
  const items = report.classrooms.filter((c) => !q || c.classroomName.toLowerCase().includes(q))
  const option = (id: string | null, name: string, students: number, rate: number | null) => (
    <li key={id ?? 'all'}>
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-pressed={selectedId === id}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border-l-4 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selectedId === id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent',
        )}
      >
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold', id ? 'bg-primary/12 text-primary' : 'bg-primary text-primary-foreground')}>
          {id ? name.replace(/^[^\d]*/, '').slice(0, 4) || name.slice(0, 2) : <Users className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="block text-xs text-muted-foreground">นักเรียน {students} คน</span>
        </span>
        <RatePill rate={rate} />
      </button>
    </li>
  )
  return (
    <section aria-label="เลือกห้องเรียน" className="rounded-2xl border border-border bg-card p-3 shadow-soft lg:sticky lg:top-0 lg:self-start">
      <h3 className="mb-2 px-1 text-sm font-bold text-foreground">เลือกห้องเรียน</h3>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="ค้นหาห้องเรียน..." aria-label="ค้นหาห้องเรียน" className={cn(INPUT, 'pl-9')} />
      </div>
      <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
        {option(null, 'ทุกห้องเรียน', all.students, all.total > 0 ? (all.present / all.total) * 100 : null)}
        {items.map((c) => option(c.classroomId, c.classroomName, c.students, c.rate))}
        {items.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">ไม่พบห้องเรียน</li>}
      </ul>
    </section>
  )
}

function ClassroomDetails({ report, semesterLabel }: { report: AttendanceReport; semesterLabel: string }) {
  const c = report.classroomDetail!
  const items = [
    ['ห้องเรียน', c.classroomName],
    ['นักเรียนในห้อง', `${c.students} คน`],
    ['ภาคเรียน', semesterLabel],
    ['เช็คชื่อแล้ว', `${c.sessions} ครั้ง (${c.total} รายการ)`],
    ['อัตรามาเรียนรวม', formatRate(c.rate)],
    ['ควรติดตาม', `${c.followUpCount} คน`],
  ]
  return (
    <section aria-label="ข้อมูลห้องเรียน" className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft sm:grid-cols-3 xl:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-sm font-semibold text-foreground">{value}</p>
        </div>
      ))}
    </section>
  )
}

function SubjectBreakdown({ report }: { report: AttendanceReport }) {
  return (
    <section aria-label="สถิติรายวิชาแยกตามห้องเรียน" className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <h3 className="border-b border-border px-4 py-3 text-sm font-bold text-foreground">การเข้าเรียนในรายวิชานี้ แยกตามห้องเรียน</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">ห้องเรียน</th>
              <th className="px-4 py-2 font-medium">นักเรียน</th>
              <th className="px-4 py-2 font-medium">เช็คชื่อ (ครั้ง)</th>
              <th className="px-4 py-2 font-medium">รายการเช็คชื่อ</th>
              <th className="px-4 py-2 font-medium">อัตรามาเรียน</th>
              <th className="px-4 py-2 font-medium">ควรติดตาม</th>
            </tr>
          </thead>
          <tbody>
            {report.subjectBreakdown.map((c) => (
              <tr key={c.classroomId} className="border-b border-border/70 last:border-0">
                <td className="px-4 py-2 font-medium">{c.classroomName}</td>
                <td className="px-4 py-2 text-center tabular-nums">{c.students}</td>
                <td className="px-4 py-2 text-center tabular-nums">{c.sessions}</td>
                <td className="px-4 py-2 text-center tabular-nums">{c.total}</td>
                <td className="px-4 py-2 text-center">
                  <RatePill rate={c.rate} />
                </td>
                <td className="px-4 py-2 text-center tabular-nums">{c.followUpCount} คน</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StudentSection({ report, filters, update, resetKey }: { report: AttendanceReport; filters: AttendanceReportFilters; update: (patch: Partial<AttendanceReportFilters>) => void; resetKey: string }) {
  return (
    <section aria-label="รายละเอียดนักเรียน" className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">รายละเอียดนักเรียน</h3>
          <p className="text-xs text-muted-foreground">
            {report.classroomDetail ? `ห้องเรียน: ${report.classroomDetail.classroomName} · ` : ''}นักเรียน {report.students.length} คน · ควรติดตาม {report.summary.followUpCount} คน
          </p>
        </div>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Flag className="size-3 text-destructive" /> ควรติดตาม = ตัวบ่งชี้สำหรับครู ไม่ใช่การตัดสินผลการเรียน
        </p>
      </div>
      {report.students.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">ไม่พบนักเรียนตามตัวกรองที่เลือก</div>
      ) : (
        <AttendanceStudentTable
          rows={report.students}
          sort={filters.sort}
          direction={filters.direction}
          onSort={(sort, direction) => update({ sort, direction })}
          onOpenStudent={(studentId) => update({ view: 'student', studentId })}
          resetKey={resetKey}
          hideClassroom={Boolean(report.classroomDetail)}
        />
      )}
    </section>
  )
}

function StudentView({ report, filters, update }: { report: AttendanceReport; filters: AttendanceReportFilters; update: (patch: Partial<AttendanceReportFilters>) => void }) {
  const detail = report.student
  const options = [...report.students].sort((a, b) => (a.classroomNames[0] ?? '').localeCompare(b.classroomNames[0] ?? '', 'th', { numeric: true }) || (a.number ?? 0) - (b.number ?? 0))
  return (
    <div className="space-y-4">
      <section aria-label="เลือกนักเรียน" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-soft sm:flex-row sm:items-center">
        <span className="text-sm font-semibold text-foreground">นักเรียน</span>
        <NativeSelect value={filters.studentId ?? ''} onChange={(e) => update({ studentId: e.target.value || null })} aria-label="เลือกนักเรียน" className="h-9 w-full sm:max-w-md">
          <option value="">เลือกนักเรียน...</option>
          {options.map((s) => (
            <option key={s.studentId} value={s.studentId}>
              {s.classroomNames.join(', ')} · เลขที่ {s.number ?? '-'} · {s.firstName} {s.lastName}
            </option>
          ))}
        </NativeSelect>
        {detail && dataMode === 'supabase' && detail.analyticsSubjectId && detail.analyticsClassroomId && (
          <Button asChild variant="outline" size="sm" className="sm:ml-auto">
            <Link to={buildStudentAnalyticsPath(detail.analyticsSubjectId, detail.analyticsClassroomId, detail.row.studentId)}>
              <ExternalLink className="size-4" />
              เปิดการวิเคราะห์รายบุคคล
            </Link>
          </Button>
        )}
      </section>

      {!detail ? (
        <Empty title="เลือกนักเรียนเพื่อดูประวัติการเข้าเรียน" hint="หรือคลิกชื่อนักเรียนในตารางของมุมมองอื่น" />
      ) : (
        <>
          <section aria-label="สรุปรายนักเรียน" className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft sm:grid-cols-3 xl:grid-cols-6">
            {[
              ['มาเรียน', `${detail.row.present} ครั้ง`],
              ['มาสาย', `${detail.row.late} ครั้ง`],
              ['ลา', `${detail.row.leave} ครั้ง`],
              ['ขาดเรียน', `${detail.row.absent} ครั้ง`],
              ['รวมรายการเช็คชื่อ', `${detail.row.total} รายการ`],
              ['ร้อยละการมาเรียน', `${formatRate(detail.row.rate)} · ${BAND_LABEL[detail.row.band]}`],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold text-foreground">{value}</p>
              </div>
            ))}
            {detail.row.followUp && (
              <p className="col-span-full flex items-center gap-1.5 text-sm text-destructive">
                <Flag className="size-4" /> ควรติดตาม: {detail.row.followUpReasons.join(' · ')}
              </p>
            )}
          </section>
          <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <section aria-label="แนวโน้มการเข้าเรียน" className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
                <CalendarDays className="size-4 text-primary" /> แนวโน้มรายสัปดาห์
              </h3>
              {detail.weekly.length ? <WeeklyAttendanceChart points={detail.weekly} /> : <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</p>}
            </section>
            <section aria-label="ประวัติการเช็คชื่อ" className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              <h3 className="border-b border-border px-4 py-3 text-sm font-bold text-foreground">ประวัติการเช็คชื่อ ({detail.history.length} รายการ)</h3>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {detail.history.map((h) => (
                      <tr key={h.sessionId} className="border-b border-border/70 last:border-0">
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{formatThaiDate(h.date)}</td>
                        <td className="px-4 py-2">{h.subjectName ?? 'เช็คชื่อประจำวัน'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{h.classroomName}</td>
                        <td className="px-4 py-2 text-right">
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_TONE[h.status])}>{STATUS_LABEL[h.status]}</span>
                        </td>
                      </tr>
                    ))}
                    {detail.history.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground">ยังไม่มีบันทึกการเช็คชื่อในช่วงที่เลือก</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

const STATUS_TONE = {
  present: 'bg-success/12 text-success',
  late: 'bg-warning/20 text-orange-600',
  leave: 'bg-violet-500/15 text-violet-500',
  absent: 'bg-destructive/12 text-destructive',
} as const
