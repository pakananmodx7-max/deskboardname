import { BookOpen, FileText, School, Users } from 'lucide-react'
import type * as React from 'react'

import type { SummaryCardValue } from '../resource'

interface SummaryCardProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** null = still loading (shows a placeholder, never 0). */
  data: SummaryCardValue | null
  error?: boolean
}

function SummaryCard({ label, icon: Icon, data, error }: SummaryCardProps) {
  return (
    <div className="kc-lift relative isolate overflow-hidden rounded-[1.25rem] border border-border bg-card p-4 shadow-soft max-sm:p-3.5 sm:p-5">
      {/* The card's own icon, large and faint, in the corner. */}
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-3 -right-3 size-16 text-primary opacity-[0.06] max-sm:size-12" />
      <div className="relative flex items-start gap-3.5 max-sm:flex-col max-sm:gap-2.5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary max-sm:size-10 sm:size-14">
          <Icon className="size-6 max-sm:size-5 sm:size-7" />
        </span>
        <div className="min-w-0 pt-0.5 max-sm:w-full max-sm:pt-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {error ? (
            <p className="mt-1.5 text-sm text-destructive">โหลดไม่สำเร็จ</p>
          ) : data === null ? (
            <div className="mt-2 h-8 w-24 animate-pulse rounded-lg bg-muted" role="status" aria-label="กำลังโหลด" />
          ) : (
            <p className="mt-0.5 text-[1.75rem] font-extrabold leading-tight tracking-tight tabular-nums text-foreground max-sm:text-2xl">{data.value ?? '-'}</p>
          )}
          {data?.hint && !error && <p className="mt-1 truncate text-xs text-muted-foreground">{data.hint}</p>}
        </div>
      </div>
    </div>
  )
}

export interface SummaryCardsProps {
  students: SummaryCardValue | null
  studentsError?: boolean
  classrooms: SummaryCardValue | null
  subjects: SummaryCardValue | null
  assignments: SummaryCardValue | null
  assignmentsError?: boolean
}

export function SummaryCards({ students, studentsError, classrooms, subjects, assignments, assignmentsError }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 max-sm:grid-cols-2 max-sm:gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="นักเรียนทั้งหมด" icon={Users} data={students} error={studentsError} />
      <SummaryCard label="ห้องเรียนทั้งหมด" icon={School} data={classrooms} />
      <SummaryCard label="รายวิชาที่สอน" icon={BookOpen} data={subjects} />
      <SummaryCard label="งาน/แบบทดสอบ" icon={FileText} data={assignments} error={assignmentsError} />
    </div>
  )
}
