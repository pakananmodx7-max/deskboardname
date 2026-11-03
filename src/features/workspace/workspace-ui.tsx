import { AlertTriangle, ArrowRight, CheckCircle2, CloudOff, Loader2, RotateCw, type LucideIcon } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { AutosaveStatus } from './note-autosave'
import { formatThaiDate, relativeDayLabel } from './workspace-dates'
import { dueState, PRIORITY_LABEL, STATUS_LABEL } from './workspace-tasks-model'
import type { TaskPriority, TaskStatus, WorkspaceTask } from './workspace-types'

export type Tone = 'blue' | 'red' | 'violet' | 'green' | 'amber' | 'slate'

const TONE_ICON: Record<Tone, string> = {
  blue: 'bg-primary/12 text-primary',
  red: 'bg-red-500/12 text-red-600 dark:text-red-400',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  green: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  slate: 'bg-muted text-muted-foreground',
}

/** A rounded white card with an optional title row. */
export function Panel({
  title,
  icon: Icon,
  action,
  children,
  className,
  id,
  bodyClassName,
}: {
  title?: string
  icon?: LucideIcon
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  id?: string
  bodyClassName?: string
}) {
  return (
    <section id={id} aria-labelledby={id && title ? `${id}-title` : undefined} className={cn('flex min-w-0 flex-col rounded-2xl border border-border bg-card shadow-sm', className)}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <h2 id={id ? `${id}-title` : undefined} className="flex min-w-0 items-center gap-2 text-base font-bold text-foreground">
            {Icon && <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />}
            <span className="truncate">{title}</span>
          </h2>
          {action}
        </div>
      )}
      <div className={cn('min-w-0 flex-1 p-4 sm:px-5', title && 'pt-3', bodyClassName)}>{children}</div>
    </section>
  )
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:text-sm">
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </button>
  )
}

export function StatCard({ icon: Icon, tone, label, value, unit = 'รายการ', hint, loading, onClick, testId }: { icon: LucideIcon; tone: Tone; label: string; value: number; unit?: string; hint?: React.ReactNode; loading: boolean; onClick?: () => void; testId: string }) {
  const body = (
    <>
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl sm:size-14', TONE_ICON[tone])} aria-hidden="true">
        <Icon className="size-6 sm:size-7" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-sm font-medium text-foreground/80">{label}</span>
        {loading ? (
          <span className="mt-1 block h-7 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <span className="block text-sm text-muted-foreground">
            <span className={cn('mr-1 text-2xl font-bold tabular-nums sm:text-3xl', tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')} data-testid={`${testId}-value`}>
              {value}
            </span>
            {unit}
          </span>
        )}
        {hint && !loading && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
    </>
  )
  const cls = 'flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm sm:gap-4 sm:p-4'
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40')} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, compact }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-center', compact ? 'px-4 py-5' : 'px-6 py-10')}>
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground sm:text-sm">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function ListSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-2.5" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="size-5 animate-pulse rounded bg-muted" />
          <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <span className="h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="size-7 text-destructive" aria-hidden="true" />
      <p className="max-w-md text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCw />
          ลองใหม่
        </Button>
      )}
    </div>
  )
}

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  high: 'bg-red-500/12 text-red-700 dark:text-red-300',
  medium: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  low: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
}

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold', PRIORITY_STYLE[priority], className)}>{PRIORITY_LABEL[priority]}</span>
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary/12 text-primary',
  done: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
}

/** "วันนี้" / "เลยมา 2 วัน" / "3 พ.ย." with the matching colour. */
export function DueLabel({ task, today, className }: { task: Pick<WorkspaceTask, 'dueDate' | 'status'>; today: string; className?: string }) {
  if (!task.dueDate) return null
  const state = dueState(task, today)
  const style =
    state === 'overdue'
      ? 'text-red-600 dark:text-red-400 font-semibold'
      : state === 'today'
        ? 'text-orange-600 dark:text-orange-400 font-semibold'
        : state === 'soon'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-muted-foreground'
  const label = state === 'done' ? formatThaiDate(task.dueDate, today) : relativeDayLabel(task.dueDate, today)
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs tabular-nums', style, className)} title={formatThaiDate(task.dueDate)}>
      {state === 'overdue' && <AlertTriangle className="size-3.5" aria-hidden="true" />}
      {state === 'overdue' && <span className="sr-only">เลยกำหนด</span>}
      {label}
    </span>
  )
}

export function SaveIndicator({ status }: { status: AutosaveStatus | undefined }) {
  const state = status?.state ?? 'idle'
  const view: Record<string, { icon: React.ReactNode; text: string; cls: string } | null> = {
    idle: { icon: <CheckCircle2 className="size-3.5" />, text: 'บันทึกแล้ว', cls: 'text-muted-foreground' },
    pending: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'กำลังบันทึก…', cls: 'text-muted-foreground' },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'กำลังบันทึก…', cls: 'text-muted-foreground' },
    saved: { icon: <CheckCircle2 className="size-3.5" />, text: 'บันทึกแล้ว', cls: 'text-emerald-600 dark:text-emerald-400' },
    error: { icon: <AlertTriangle className="size-3.5" />, text: 'บันทึกไม่สำเร็จ — กำลังลองใหม่', cls: 'text-destructive' },
    offline: { icon: <CloudOff className="size-3.5" />, text: 'ออฟไลน์ — จะบันทึกเมื่อกลับมาออนไลน์', cls: 'text-amber-700 dark:text-amber-400' },
    conflict: { icon: <AlertTriangle className="size-3.5" />, text: 'มีการแก้ไขจากอุปกรณ์อื่น', cls: 'text-destructive' },
    invalid: { icon: <AlertTriangle className="size-3.5" />, text: status?.message ?? 'ข้อมูลไม่ถูกต้อง', cls: 'text-destructive' },
  }
  const v = view[state]
  if (!v) return null
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1 text-xs', v.cls)} data-testid="note-save-status" data-state={state}>
      {v.icon}
      {v.text}
    </span>
  )
}

/** Segmented control (e.g. เดือน / สัปดาห์). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:text-sm', value === o.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Free-text category with the built-in + previously used suggestions. */
export function CategoryInput({ id, value, onChange, options, placeholder = 'เลือกหรือพิมพ์หมวดหมู่ใหม่' }: { id: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <>
      <input
        id={id}
        list={`${id}-options`}
        value={value}
        maxLength={60}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex h-9 w-full rounded-xl border border-input bg-background px-3.5 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}
