import { AlarmClock, Leaf, Plus, Target, Zap, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

import { useWorkspaceStore } from './workspace-hooks'
import { groupByQuadrant, QUADRANTS, quadrantFlags, quadrantOf, type Quadrant } from './workspace-tasks-model'
import type { WorkspaceTask } from './workspace-types'
import { DueLabel } from './workspace-ui'

const STYLE: Record<Quadrant, { icon: LucideIcon; box: string; title: string }> = {
  do: { icon: AlarmClock, box: 'bg-red-500/8 border-red-500/20 dark:bg-red-500/10', title: 'text-red-700 dark:text-red-300' },
  plan: { icon: Target, box: 'bg-primary/8 border-primary/20 dark:bg-primary/12', title: 'text-primary' },
  delegate: { icon: Zap, box: 'bg-amber-500/10 border-amber-500/25 dark:bg-amber-500/10', title: 'text-amber-800 dark:text-amber-300' },
  later: { icon: Leaf, box: 'bg-emerald-500/8 border-emerald-500/20 dark:bg-emerald-500/10', title: 'text-emerald-700 dark:text-emerald-300' },
}

const DRAG_TYPE = 'application/x-kc-task'

/**
 * Eisenhower matrix over the same task records as the list, calendar and
 * board (open tasks only). A task moves between quadrants by drag and
 * drop on desktop, or with its "ย้ายไป" menu (keyboard / touch).
 */
export function PriorityMatrix({ tasks, today, onOpen, onAdd, limit }: { tasks: WorkspaceTask[]; today: string; onOpen: (id: string) => void; onAdd?: (q: Quadrant) => void; limit?: number }) {
  const store = useWorkspaceStore()
  const groups = groupByQuadrant(tasks)
  const [over, setOver] = useState<Quadrant | null>(null)

  const move = (task: WorkspaceTask, q: Quadrant) => {
    if (quadrantOf(task) !== q) void store.updateTask(task.id, quadrantFlags(q))
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="priority-matrix">
      {QUADRANTS.map((q) => {
        const style = STYLE[q.key]
        const Icon = style.icon
        const list = groups[q.key]
        const shown = limit ? list.slice(0, limit) : list
        return (
          <section
            key={q.key}
            aria-label={`${q.title} — ${q.action}`}
            data-quadrant={q.key}
            className={cn('flex min-h-28 min-w-0 flex-col rounded-2xl border p-3 transition-shadow', style.box, over === q.key && 'ring-2 ring-primary/50')}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              setOver(q.key)
            }}
            onDragLeave={() => setOver((cur) => (cur === q.key ? null : cur))}
            onDrop={(e) => {
              e.preventDefault()
              setOver(null)
              const task = tasks.find((t) => t.id === e.dataTransfer.getData(DRAG_TYPE))
              if (task) move(task, q.key)
            }}
          >
            <header className="flex items-start gap-2">
              <Icon className={cn('mt-0.5 size-5 shrink-0', style.title)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className={cn('text-sm font-bold', style.title)}>{q.title}</h3>
                <p className="text-xs text-foreground/70">
                  {q.action} · {list.length} งาน
                </p>
              </div>
              {onAdd && (
                <button type="button" onClick={() => onAdd(q.key)} className="rounded-full p-1 text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`เพิ่มงานในช่อง ${q.title}`}>
                  <Plus className="size-4" />
                </button>
              )}
            </header>
            {list.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีงานในช่องนี้</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {shown.map((t) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, t.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    className="group flex items-center gap-1.5 rounded-lg bg-card/70 px-2 py-1 text-sm shadow-xs md:cursor-grab"
                    data-testid="matrix-task"
                  >
                    <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      {t.title}
                    </button>
                    <DueLabel task={t} today={today} className="hidden sm:inline-flex" />
                    <select
                      aria-label={`ย้าย “${t.title}” ไปช่องอื่น`}
                      value={q.key}
                      onChange={(e) => move(t, e.target.value as Quadrant)}
                      className="w-6 shrink-0 cursor-pointer appearance-none rounded bg-transparent text-center text-xs text-muted-foreground opacity-70 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover:opacity-100"
                      title="ย้ายไปช่องอื่น"
                    >
                      {QUADRANTS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.key === q.key ? '⋮' : `ย้ายไป: ${o.title}`}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
                {limit && list.length > limit && <li className="px-2 text-xs text-muted-foreground">และอีก {list.length - limit} งาน</li>}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
