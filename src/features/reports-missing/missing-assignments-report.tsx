import { AlertTriangle, ChevronDown, ChevronsDownUp, ChevronsUpDown, Clock, Download, ExternalLink, FileText, Printer, RotateCw, Search, Users, UserX } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import type * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { todayIso } from '@/features/classroom-analytics/analytics'
import { SemesterSelect } from '@/features/semester/semester-select'
import { useSemester } from '@/features/semester/semester-store'
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { downloadMissingCsv, downloadMissingDocx } from './missing-report-exports'
import {
  buildMissingReport,
  buildReportMeta,
  formatThaiDate,
  OBLIGATION_STATUS_LABEL,
  SORT_LABEL,
  STATUS_FILTER_LABEL,
  studentDisplayName,
  type MissingObligation,
  type MissingReportFilters,
  type SortKey,
  type StatusFilter,
} from './missing-report-model'
import { filtersFromParams, filtersToParams, printPreviewHref } from './missing-report-params'
import type { MissingReportData } from './use-missing-report-data'

export interface MissingAssignmentsReportProps {
  useData: () => MissingReportData
  teacherName: string | null
}

const STATUS_BADGE: Record<MissingObligation['status'], string> = {
  pending: 'bg-warning/20 text-orange-600',
  overdue: 'bg-destructive/12 text-destructive',
  no_due: 'bg-muted text-muted-foreground',
}

/**
 * Reports → งานค้างส่ง. One row per student (sorted by total outstanding
 * work), expandable to that student's individual assignments. Every
 * number, the print preview and every export come from the same
 * buildMissingReport() result for the same filters (kept in the URL).
 */
export function MissingAssignmentsReport({ useData, teacherName }: MissingAssignmentsReportProps) {
  const { context, scope, retryContext } = useSemester()
  const { data, refresh } = useData()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [exporting, setExporting] = useState<'csv' | 'docx' | null>(null)
  const today = todayIso()

  function update(patch: Partial<MissingReportFilters>) {
    setSearchParams((prev) => filtersToParams({ ...filters, ...patch }, prev), { replace: true })
  }

  const report = useMemo(
    () =>
      context.status === 'success' && scope && data.status === 'success'
        ? buildMissingReport({ context: context.data, scope, roster: data.data[0], assignments: data.data[1], filters, today })
        : null,
    [context, scope, data, filters, today],
  )
  const meta = useMemo(
    () => (context.status === 'success' && scope ? buildReportMeta({ context: context.data, scope, filters, teacherName, today }) : null),
    [context, scope, filters, teacherName, today],
  )

  const classroomOptions = scope?.classrooms ?? []
  const subjectOptions = scope?.subjects ?? []
  const loading = context.status === 'loading' || !scope || data.status === 'loading'
  const error = context.status === 'error' ? context.error : data.status === 'error' ? data.error : null
  const allExpanded = report !== null && report.students.length > 0 && report.students.every((s) => expanded.has(s.studentId))

  function toggle(studentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  async function runExport(kind: 'csv' | 'docx') {
    if (!report || !meta) return
    setExporting(kind)
    try {
      if (kind === 'csv') downloadMissingCsv(report, meta)
      else await downloadMissingDocx(report, meta)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ส่งออกรายงานไม่สำเร็จ'))
    } finally {
      setExporting(null)
    }
  }

  const exportDisabled = !report || report.obligations.length === 0 || exporting !== null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">รายงานงานค้างส่ง</h2>
          <p className="text-sm text-muted-foreground">
            {meta ? `${meta.semesterLabel} · ${meta.classroomLabel} · ${meta.subjectLabel} · ${meta.periodLabel}` : 'กำลังโหลดขอบเขตรายงาน...'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RotateCw className={cn('size-4', loading && 'animate-spin')} />
            รีเฟรช
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => runExport('csv')} disabled={exportDisabled}>
            <Download className="size-4" />
            {exporting === 'csv' ? 'กำลังส่งออก...' : 'CSV'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => runExport('docx')} disabled={exportDisabled}>
            <FileText className="size-4" />
            {exporting === 'docx' ? 'กำลังสร้างไฟล์...' : 'Word'}
          </Button>
          <Button asChild size="sm">
            <Link to={printPreviewHref(filters)}>
              <Printer className="size-4" />
              พิมพ์ / PDF
            </Link>
          </Button>
        </div>
      </div>

      <section aria-label="สรุปงานค้างส่ง" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Users} tone="bg-primary/12 text-primary" label="นักเรียนทั้งหมด" unit="คน" value={report?.summary.totalStudents} hint="ในห้องเรียนที่เลือก (ไม่นับซ้ำ)" />
        <SummaryCard icon={UserX} tone="bg-violet-500/15 text-violet-500" label="นักเรียนที่มีงานค้าง" unit="คน" value={report?.summary.studentsWithMissing} hint="มีงานยังไม่ส่งหรือขาดส่งอย่างน้อย 1 งาน" />
        <SummaryCard
          icon={Clock}
          tone="bg-warning/20 text-orange-500"
          label="งานที่ยังไม่ส่ง"
          unit="รายการ"
          value={report?.summary.pending}
          hint={report && report.summary.noDue > 0 ? `ยังไม่เลยกำหนด · รวมไม่มีกำหนดส่ง ${report.summary.noDue} รายการ` : 'ยังไม่เลยกำหนดส่ง (นับเป็นนักเรียน × งาน)'}
        />
        <SummaryCard icon={AlertTriangle} tone="bg-destructive/12 text-destructive" label="งานที่ขาดส่ง" unit="รายการ" value={report?.summary.overdue} hint="เลยกำหนดส่งหรือครูระบุว่าขาดส่ง" />
      </section>

      <section aria-label="ตัวกรองรายงาน" className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft sm:grid-cols-2 lg:grid-cols-4">
        <Field label="ภาคเรียน" className="sm:col-span-2">
          <SemesterSelect id="missing-report-semester" className="[&_select]:w-full [&_select]:max-w-none" />
        </Field>
        <Field label="ห้องเรียน">
          <NativeSelect value={filters.classroomId ?? ''} onChange={(e) => update({ classroomId: e.target.value || null })} aria-label="ห้องเรียน" className="h-9 w-full">
            <option value="">ทุกห้องเรียน</option>
            {classroomOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="รายวิชา">
          <NativeSelect value={filters.subjectId ?? ''} onChange={(e) => update({ subjectId: e.target.value || null })} aria-label="รายวิชา" className="h-9 w-full">
            <option value="">ทุกรายวิชา</option>
            {subjectOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="กำหนดส่งตั้งแต่">
          <input type="date" value={filters.from ?? ''} max={filters.to ?? undefined} onChange={(e) => update({ from: e.target.value || null })} aria-label="กำหนดส่งตั้งแต่" className={INPUT} />
        </Field>
        <Field label="ถึง">
          <input type="date" value={filters.to ?? ''} min={filters.from ?? undefined} onChange={(e) => update({ to: e.target.value || null })} aria-label="กำหนดส่งถึง" className={INPUT} />
        </Field>
        <Field label="สถานะ">
          <NativeSelect value={filters.status} onChange={(e) => update({ status: e.target.value as StatusFilter })} aria-label="สถานะงาน" className="h-9 w-full">
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((key) => (
              <option key={key} value={key}>
                {STATUS_FILTER_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="เรียงตาม">
          <NativeSelect value={filters.sort} onChange={(e) => update({ sort: e.target.value as SortKey })} aria-label="เรียงตาม" className="h-9 w-full">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="ค้นหานักเรียน" className="sm:col-span-2 lg:col-span-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filters.search}
              onChange={(e) => update({ search: e.target.value })}
              placeholder="ชื่อ นามสกุล เลขที่ หรือรหัสนักเรียน..."
              aria-label="ค้นหานักเรียน"
              className={cn(INPUT, 'pl-9')}
            />
          </div>
        </Field>
      </section>
      <p className="-mt-2 text-xs text-muted-foreground">
        ช่วงวันที่กรองตาม “กำหนดส่ง” ของงาน — งานที่ไม่มีกำหนดส่งแสดงเสมอ · “ส่งช้า” นับว่าส่งแล้ว · นักเรียนนับเป็นคน งานนับเป็นรายการ (นักเรียน × งาน)
      </p>

      <section aria-label="ตารางนักเรียนที่มีงานค้าง" className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold text-foreground">นักเรียนที่มีงานค้างส่ง {report ? `(${report.students.length} คน)` : ''}</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!report || report.students.length === 0}
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(report?.students.map((s) => s.studentId)))}
          >
            {allExpanded ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
            {allExpanded ? 'ย่อทั้งหมด' : 'ขยายทั้งหมด'}
          </Button>
        </div>

        {error ? (
          <div role="alert" className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-6 text-destructive" />
            <p className="text-sm text-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={context.status === 'error' ? retryContext : refresh}>
              <RotateCw className="size-4" />
              ลองใหม่
            </Button>
          </div>
        ) : loading || !report ? (
          <div className="space-y-2 p-4" role="status" aria-label="กำลังโหลดรายงาน" data-testid="missing-report-loading">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : scope && scope.classrooms.length === 0 ? (
          <Empty title={`ยังไม่มีห้องเรียนใน${scope.label}`} hint="เลือกภาคเรียนอื่นจากตัวเลือกด้านบน" />
        ) : report.students.length === 0 ? (
          <Empty
            title={report.summary.totalStudents === 0 ? 'ไม่พบนักเรียนตามตัวกรองที่เลือก' : 'ไม่มีงานค้างส่งตามตัวกรองที่เลือก'}
            hint={report.summary.totalStudents === 0 ? 'ลองเปลี่ยนห้องเรียน รายวิชา หรือคำค้นหา' : 'นักเรียนทุกคนส่งงานครบแล้ว หรือไม่มีงานในช่วงกำหนดส่งนี้'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="w-16 px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="px-4 py-2.5 font-medium">ชื่อ–นามสกุล</th>
                  <th className="px-4 py-2.5 font-medium">ห้องเรียน</th>
                  <th className="px-4 py-2.5 text-center font-medium">งานที่ยังไม่ส่ง</th>
                  <th className="px-4 py-2.5 text-center font-medium">งานที่ขาดส่ง</th>
                  <th className="px-4 py-2.5 text-center font-medium">รวมงานค้าง</th>
                  <th className="px-4 py-2.5 text-right font-medium">ดูรายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {report.students.map((student) => {
                  const open = expanded.has(student.studentId)
                  const detailId = `missing-detail-${student.studentId}`
                  return (
                    <Fragment key={student.studentId}>
                      <tr className={cn('border-b border-border', open && 'bg-primary/5')}>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{student.number ?? '-'}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">{studentDisplayName(student)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{student.classroomNames.join(', ')}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">
                          <CountPill value={student.pending} tone="bg-warning/20 text-orange-600" />
                        </td>
                        <td className="px-4 py-2.5 text-center tabular-nums">
                          <CountPill value={student.overdue} tone="bg-destructive/12 text-destructive" />
                        </td>
                        <td className="px-4 py-2.5 text-center text-base font-bold tabular-nums text-foreground">{student.total}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => toggle(student.studentId)} aria-expanded={open} aria-controls={detailId}>
                            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
                            {open ? 'ซ่อน' : 'ดูรายละเอียด'}
                          </Button>
                        </td>
                      </tr>
                      {open && (
                        <tr id={detailId} className="border-b border-border bg-muted/30">
                          <td colSpan={7} className="px-4 py-3">
                            <ul className="space-y-1.5">
                              {student.obligations.map((o, i) => (
                                <li key={o.assignmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-card px-3 py-2 text-sm shadow-soft">
                                  <span className="w-5 tabular-nums text-muted-foreground">{i + 1}.</span>
                                  <Link to={buildAssignmentDetailPath(o.subjectId, o.classroomId, o.assignmentId)} className="inline-flex min-w-0 items-center gap-1 font-medium text-primary hover:underline">
                                    <span className="truncate">{o.assignmentTitle}</span>
                                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                                  </Link>
                                  <span className="text-muted-foreground">{o.subjectName}</span>
                                  <span className="text-muted-foreground">ห้อง {o.classroomName}</span>
                                  <span className="text-muted-foreground">กำหนดส่ง {o.dueDate ? formatThaiDate(o.dueDate) : '—'}</span>
                                  <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_BADGE[o.status])}>
                                    {OBLIGATION_STATUS_LABEL[o.status]}
                                    {o.daysOverdue ? ` · เลยกำหนด ${o.daysOverdue} วัน` : ''}
                                    {o.markedMissing ? ' · ครูระบุ' : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

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

function SummaryCard({ icon: Icon, tone, label, unit, value, hint }: { icon: React.ComponentType<{ className?: string }>; tone: string; label: string; unit: string; value: number | undefined; hint: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full', tone)}>
        <Icon className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        {value === undefined ? (
          <div className="mt-1 h-7 w-20 animate-pulse rounded bg-muted" role="status" aria-label="กำลังโหลด" />
        ) : (
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {value.toLocaleString('th-TH')} <span className="text-base font-semibold">{unit}</span>
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground" title={hint}>
          {hint}
        </p>
      </div>
    </div>
  )
}

function CountPill({ value, tone }: { value: number; tone: string }) {
  return value > 0 ? <span className={cn('inline-flex min-w-8 justify-center rounded-full px-2 py-0.5 text-sm font-semibold', tone)}>{value}</span> : <span className="text-muted-foreground">0</span>
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
