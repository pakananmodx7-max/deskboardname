import { BookOpen, FileText, School, Users } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

import type { SummaryCardValue } from '../resource'
import { StatDecoration } from './dashboard-decor'

type StatTone = 'kc-tone-blue' | 'kc-tone-lavender' | 'kc-tone-mint' | 'kc-tone-orange'

interface SummaryCardProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  tone: StatTone
  /** Picks one of the two decoration shapes. */
  variant: number
  /** null = still loading (shows a placeholder, never 0). */
  data: SummaryCardValue | null
  error?: boolean
}

function SummaryCard({ label, icon: Icon, tone, variant, data, error }: SummaryCardProps) {
  return (
    <div className={cn('kc-pastel-card kc-lift relative isolate overflow-hidden rounded-[1.25rem] border p-4 shadow-soft sm:p-5', tone)}>
      <StatDecoration variant={variant} />
      <div className="relative flex items-start gap-3.5">
        <span className="kc-tone-chip flex size-12 shrink-0 items-center justify-center rounded-full ring-4 ring-[color:color-mix(in_oklab,var(--tone)_10%,transparent)] sm:size-14">
          <Icon className="size-6 sm:size-7" />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {error ? (
            <p className="mt-1.5 text-sm text-destructive">โหลดไม่สำเร็จ</p>
          ) : data === null ? (
            <div className="mt-2 h-8 w-24 animate-pulse rounded-lg bg-muted" role="status" aria-label="กำลังโหลด" />
          ) : (
            <p className="mt-0.5 text-[1.75rem] font-extrabold leading-tight tracking-tight tabular-nums text-foreground">{data.value ?? '-'}</p>
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="นักเรียนทั้งหมด" icon={Users} tone="kc-tone-blue" variant={0} data={students} error={studentsError} />
      <SummaryCard label="ห้องเรียนทั้งหมด" icon={School} tone="kc-tone-lavender" variant={1} data={classrooms} />
      <SummaryCard label="รายวิชาที่สอน" icon={BookOpen} tone="kc-tone-mint" variant={2} data={subjects} />
      <SummaryCard label="งาน/แบบทดสอบ" icon={FileText} tone="kc-tone-orange" variant={3} data={assignments} error={assignmentsError} />
    </div>
  )
}
