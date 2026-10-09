import { BookOpen, FileText, School, Users } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

import { ICON_TONE, type IconTone, type SummaryCardValue } from '../resource'

interface SummaryCardProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  tone: IconTone
  /** null = still loading (shows a placeholder, never 0). */
  data: SummaryCardValue | null
  error?: boolean
}

function SummaryCard({ label, icon: Icon, tone, data, error }: SummaryCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <Icon className={cn('pointer-events-none absolute -bottom-3 -right-2 size-20 opacity-[0.07]', ICON_TONE[tone].split(' ').find((c) => c.startsWith('text-')))} aria-hidden="true" />
      <div className="flex items-center gap-3.5">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full', ICON_TONE[tone])}>
          <Icon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {error ? (
            <p className="mt-1 text-sm text-destructive">โหลดไม่สำเร็จ</p>
          ) : data === null ? (
            <div className="mt-1.5 h-7 w-24 animate-pulse rounded bg-muted" role="status" aria-label="กำลังโหลด" />
          ) : (
            <p className="text-2xl font-bold tabular-nums text-foreground">{data.value ?? '-'}</p>
          )}
          {data?.hint && !error && <p className="mt-0.5 truncate text-xs text-muted-foreground">{data.hint}</p>}
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="นักเรียนทั้งหมด" icon={Users} tone="blue" data={students} error={studentsError} />
      <SummaryCard label="ห้องเรียนทั้งหมด" icon={School} tone="violet" data={classrooms} />
      <SummaryCard label="รายวิชาที่สอน" icon={BookOpen} tone="green" data={subjects} />
      <SummaryCard label="งาน/แบบทดสอบ" icon={FileText} tone="orange" data={assignments} error={assignmentsError} />
    </div>
  )
}
