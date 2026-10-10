import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { AttendanceSummaryReport } from '@/features/reports-real/attendance-summary-report'
import { FollowUpReport } from '@/features/reports-real/followup-report'
import { GradeSummaryReport } from '@/features/reports-real/grade-summary-report'
import { ReportFiltersBar } from '@/features/reports-real/report-filters-bar'
import { MissingAssignmentsReport } from '@/features/reports-missing/missing-assignments-report'
import { useMissingReportData } from '@/features/reports-missing/missing-report-data-source'
import { useReportTeacherName } from '@/features/reports-missing/use-report-teacher-name'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getDefaultReportFilters, getReportFilterOptions, type ReportFilterOptions } from '@/services/report-service'
import type { ReportFilters } from '@/types/report'

type ReportTab = 'attendance' | 'grades' | 'missing' | 'followup'

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'attendance', label: 'สรุปการเข้าเรียน' },
  { key: 'grades', label: 'สรุปคะแนน' },
  { key: 'missing', label: 'งานค้างส่ง' },
  { key: 'followup', label: 'นักเรียนที่ควรติดตาม' },
]

const EMPTY_OPTIONS: ReportFilterOptions = { classrooms: [], subjects: [] }

function isReportTab(value: string | null): value is ReportTab {
  return TABS.some((tab) => tab.key === value)
}

/**
 * Real, Supabase-backed teacher reports. Every report below reads
 * exclusively through this schema's existing RLS (see
 * report-service.ts's doc comment) — no new table, no RLS change, no
 * demo/mock fallback of any kind. Grades stay derived from
 * assignment_submissions.score (never a stored grades table), same as
 * the real Grades tab.
 */
export function ReportsPageReal() {
  // ?tab= keeps the open tab across refreshes and lets the print preview's
  // "กลับไปรายงาน" land back on งานค้างส่ง with its filters.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: ReportTab = isReportTab(tabParam) ? tabParam : 'attendance'
  const teacherName = useReportTeacherName()

  function setActiveTab(tab: ReportTab) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', tab)
        return next
      },
      { replace: true },
    )
  }
  const [options, setOptions] = useState<ReportFilterOptions>(EMPTY_OPTIONS)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ReportFilters>(getDefaultReportFilters)

  useEffect(() => {
    let active = true
    getReportFilterOptions()
      .then((data) => {
        if (active) setOptions(data)
      })
      .catch((err: unknown) => {
        if (active) setOptionsError(toFriendlyErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [])

  const classroomName = filters.classroomId
    ? (options.classrooms.find((c) => c.id === filters.classroomId)?.name ?? null)
    : null
  const subjectName = filters.subjectId ? (options.subjects.find((s) => s.id === filters.subjectId)?.name ?? null) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">รายงาน</h1>
        <p className="mt-1 text-sm text-muted-foreground">รายงานจากข้อมูลจริงในระบบ — กรองตามห้องเรียน วิชา และช่วงวันที่</p>
      </div>

      {optionsError && <p className="text-sm text-destructive">{optionsError}</p>}

      {/* งานค้างส่ง has its own filter toolbar (semester, status, search...). */}
      {activeTab !== 'missing' && <ReportFiltersBar filters={filters} options={options} onChange={setFilters} />}

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => (
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

      {activeTab === 'attendance' && (
        <AttendanceSummaryReport filters={filters} classroomName={classroomName} subjectName={subjectName} />
      )}
      {activeTab === 'grades' && (
        <GradeSummaryReport filters={filters} classroomName={classroomName} subjectName={subjectName} />
      )}
      {activeTab === 'missing' && (
        <MissingAssignmentsReport useData={useMissingReportData} teacherName={teacherName} />
      )}
      {activeTab === 'followup' && (
        <FollowUpReport filters={filters} classroomName={classroomName} subjectName={subjectName} />
      )}
    </div>
  )
}
