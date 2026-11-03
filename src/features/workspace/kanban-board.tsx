import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, Plus } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

import { useWorkspaceStore } from './workspace-hooks'
import { columnTasks, planMove, TASK_STATUSES } from './workspace-tasks-model'
import type { TaskStatus, WorkspaceTask } from './workspace-types'
import { DueLabel, PriorityBadge } from './workspace-ui'

const DRAG_TYPE = 'application/x-kc-task'

const COLUMN_STYLE: Record<TaskStatus, string> = {
  todo: 'bg-slate-500',
  in_progress: 'bg-primary',
  done: 'bg-emerald-500',
}

/**
 * กระดานงาน: the same task records, one column per status. Cards are
 * dragged between/within columns on desktop; every card also has move
 * buttons (left/right = status, up/down = order) for keyboard and touch.
 */
export function KanbanBoard({ tasks, today, onOpen, onAdd }: { tasks: WorkspaceTask[]; today: string; onOpen: (id: string) => void; onAdd: (status: TaskStatus) => void }) {
  const store = useWorkspaceStore()
  const [drop, setDrop] = useState<{ status: TaskStatus; index: number } | null>(null)
  const [announce, setAnnounce] = useState('')

  const move = (taskId: string, status: TaskStatus, index: number) => {
    const changes = planMove(tasks, taskId, status, index)
    if (changes.length === 0) return
    void store.updateTasks(changes)
    const task = tasks.find((t) => t.id === taskId)
    const label = TASK_STATUSES.find((s) => s.key === status)?.label
    if (task) setAnnounce(`ย้าย “${task.title}” ไปที่ ${label} ลำดับที่ ${index + 1}`)
  }

  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="kanban-board">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {TASK_STATUSES.map((col, colIndex) => {
        const list = columnTasks(tasks, col.key)
        const dropIndex = drop?.status === col.key ? drop.index : null
        return (
          <section
            key={col.key}
            aria-label={`${col.label} (${list.length})`}
            data-column={col.key}
            className={cn('flex min-w-0 flex-col rounded-2xl border border-border bg-muted/40 p-3 transition-colors', dropIndex !== null && 'border-primary/50 bg-primary/5')}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              // Drop index from the pointer position among this column's cards.
              const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')]
              const index = cards.findIndex((c) => {
                const r = c.getBoundingClientRect()
                return e.clientY < r.top + r.height / 2
              })
              setDrop({ status: col.key, index: index === -1 ? cards.length : index })
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData(DRAG_TYPE)
              const index = drop?.status === col.key ? drop.index : list.length
              setDrop(null)
              if (!id) return
              // The index counted the dragged card itself if it was above the drop point.
              const from = list.findIndex((t) => t.id === id)
              move(id, col.key, from !== -1 && from < index ? index - 1 : index)
            }}
          >
            <header className="mb-2 flex items-center gap-2 px-1">
              <span className={cn('size-2.5 rounded-full', COLUMN_STYLE[col.key])} aria-hidden="true" />
              <h3 className="text-sm font-bold text-foreground">{col.label}</h3>
              <span className="rounded-full bg-card px-2 text-xs tabular-nums text-muted-foreground">{list.length}</span>
              <button type="button" onClick={() => onAdd(col.key)} className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`เพิ่มงานในคอลัมน์ ${col.label}`}>
                <Plus className="size-4" />
              </button>
            </header>
            <ol className="flex min-h-24 flex-col gap-2">
              {list.map((t, i) => (
                <li key={t.id} className="relative">
                  {dropIndex === i && <span className="absolute -top-1.5 left-1 right-1 h-0.5 rounded bg-primary" aria-hidden="true" />}
                  <article
                    data-card
                    data-task-id={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, t.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => setDrop(null)}
                    className="group rounded-xl border border-border bg-card p-2.5 shadow-sm md:cursor-grab"
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="mt-0.5 hidden size-4 shrink-0 text-muted-foreground/50 md:block" aria-hidden="true" />
                      <button type="button" onClick={() => onOpen(t.id)} className={cn('min-w-0 flex-1 rounded text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', t.status === 'done' ? 'text-muted-foreground line-through' : 'font-medium text-foreground')}>
                        {t.title}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <PriorityBadge priority={t.priority} />
                      <DueLabel task={t} today={today} />
                      {t.category && <span className="truncate text-xs text-muted-foreground">{t.category}</span>}
                      <span className="ml-auto flex items-center gap-0.5">
                        <MoveButton label={`เลื่อน “${t.title}” ขึ้น`} disabled={i === 0} onClick={() => move(t.id, col.key, i - 1)} icon={ArrowUp} />
                        <MoveButton label={`เลื่อน “${t.title}” ลง`} disabled={i === list.length - 1} onClick={() => move(t.id, col.key, i + 1)} icon={ArrowDown} />
                        <MoveButton label={`ย้าย “${t.title}” ไป ${TASK_STATUSES[colIndex - 1]?.label ?? ''}`} disabled={colIndex === 0} onClick={() => move(t.id, TASK_STATUSES[colIndex - 1].key, 0)} icon={ArrowLeft} />
                        <MoveButton label={`ย้าย “${t.title}” ไป ${TASK_STATUSES[colIndex + 1]?.label ?? ''}`} disabled={colIndex === TASK_STATUSES.length - 1} onClick={() => move(t.id, TASK_STATUSES[colIndex + 1].key, 0)} icon={ArrowRight} />
                      </span>
                    </div>
                  </article>
                </li>
              ))}
              {dropIndex === list.length && <li className="h-0.5 rounded bg-primary" aria-hidden="true" />}
              {list.length === 0 && <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">ลากงานมาวางที่นี่ หรือกด + เพื่อเพิ่ม</li>}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function MoveButton({ label, disabled, onClick, icon: Icon }: { label: string; disabled: boolean; onClick: () => void; icon: typeof ArrowUp }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-30">
      <Icon className="size-3.5" />
    </button>
  )
}
