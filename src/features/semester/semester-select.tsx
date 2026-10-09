import { CalendarDays } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useOptionalSemester } from './semester-store'

export const SEMESTER_SELECT_ID = 'global-semester-select'

/**
 * The header's semester selector — the single control every dashboard
 * widget follows. Read/filter only: changing it never writes classroom,
 * student, subject or academic-term data.
 */
export function SemesterSelect({ className, id = SEMESTER_SELECT_ID }: { className?: string; id?: string }) {
  const semester = useOptionalSemester()
  if (!semester) return null
  const { context, options, semesterKey, setSemester } = semester
  const loading = context.status !== 'success'

  return (
    <label className={cn('relative flex items-center', className)}>
      <span className="sr-only">ภาคเรียน</span>
      <CalendarDays className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
      <select
        id={id}
        value={semesterKey ?? ''}
        onChange={(e) => setSemester(e.target.value)}
        disabled={loading}
        aria-label="เลือกภาคเรียน"
        className="h-9 max-w-[200px] appearance-none truncate rounded-xl border border-input bg-card py-1 pl-9 pr-8 text-sm font-medium text-foreground shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-70"
      >
        {loading && <option value="">{context.status === 'error' ? 'โหลดภาคเรียนไม่สำเร็จ' : 'กำลังโหลดภาคเรียน...'}</option>}
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 size-3.5 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </label>
  )
}
