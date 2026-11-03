import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useWorkspaceStore } from './workspace-hooks'
import type { WorkspaceTask } from './workspace-types'
import { DueLabel, PriorityBadge, StatusBadge } from './workspace-ui'

/** Round completion checkbox shared by every task list. */
export function TaskCheckbox({ task }: { task: WorkspaceTask }) {
  const store = useWorkspaceStore()
  const done = task.status === 'done'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `เปิดงาน “${task.title}” อีกครั้ง` : `ทำเครื่องหมายว่า “${task.title}” เสร็จแล้ว`}
      onClick={() => void store.setTaskStatus(task.id, done ? 'todo' : 'done')}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 hover:border-primary',
      )}
    >
      {done && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
    </button>
  )
}

export function TaskRow({ task, today, onOpen, showStatus = false, compact = false, hideDue = false }: { task: WorkspaceTask; today: string; onOpen: (id: string) => void; showStatus?: boolean; compact?: boolean; hideDue?: boolean }) {
  const done = task.status === 'done'
  return (
    <li className={cn('flex items-center gap-3 border-b border-border/70 last:border-b-0', compact ? 'py-2' : 'py-2.5')} data-testid="task-row" data-task-id={task.id}>
      <TaskCheckbox task={task} />
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <span className={cn('block truncate text-sm', done ? 'text-muted-foreground line-through' : 'font-medium text-foreground')}>{task.title}</span>
        {!compact && (task.category || task.description) && <span className="block truncate text-xs text-muted-foreground">{[task.category, task.description.split('\n')[0]].filter(Boolean).join(' · ')}</span>}
        {/* Phones (and compact lists): the due day sits under the title so the title keeps its width. */}
        {!hideDue && <DueLabel task={task} today={today} className={cn('mt-0.5', !compact && 'sm:hidden')} />}
      </button>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {showStatus && !done && task.status === 'in_progress' && <StatusBadge status={task.status} />}
        {done ? <StatusBadge status="done" /> : <PriorityBadge priority={task.priority} />}
        {!compact && !hideDue && <DueLabel task={task} today={today} className="hidden min-w-[4.5rem] justify-end sm:inline-flex" />}
      </div>
    </li>
  )
}
