import { CalendarX2, Grid2x2, List, ListChecks, Loader2, Plus, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { PriorityMatrix } from './priority-matrix'
import { TaskRow } from './task-row'
import { useWorkspaceState, useWorkspaceStore } from './workspace-hooks'
import { addDays, formatThaiDate } from './workspace-dates'
import { categoryOptions, DEFAULT_TASK_CATEGORIES, filterTasks, quadrantFlags, summarizeTasks, TASK_PRIORITIES, TASK_SORTS, type Quadrant, type TaskDueFilter, type TaskFilters, type TaskSort, type TaskStatusFilter } from './workspace-tasks-model'
import type { TaskInput, TaskPriority } from './workspace-types'
import { EmptyState, ListSkeleton, Segmented } from './workspace-ui'

const STATUS_FILTERS: { key: TaskStatusFilter; label: string }[] = [
  { key: 'open', label: 'ยังไม่เสร็จ' },
  { key: 'todo', label: 'ยังไม่เริ่ม' },
  { key: 'in_progress', label: 'กำลังดำเนินการ' },
  { key: 'done', label: 'เสร็จแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
]

const DUE_FILTERS: { key: TaskDueFilter; label: string }[] = [
  { key: 'all', label: 'ทุกกำหนด' },
  { key: 'overdue', label: 'เลยกำหนด' },
  { key: 'today', label: 'ครบกำหนดวันนี้' },
  { key: 'week', label: '7 วันข้างหน้า' },
  { key: 'upcoming', label: 'กำลังจะถึง' },
  { key: 'none', label: 'ไม่มีกำหนด' },
]

export type TaskView = 'list' | 'matrix'

/** งานของฉัน: quick add, filters and the list or matrix view of the same tasks. */
export function TasksPanel({
  filters,
  onFilters,
  view,
  onView,
  today,
  loading,
  onOpen,
  onCreate,
}: {
  filters: TaskFilters
  onFilters: (patch: Partial<TaskFilters>) => void
  view: TaskView
  onView: (v: TaskView) => void
  today: string
  loading: boolean
  onOpen: (id: string) => void
  onCreate: (defaults?: Partial<TaskInput>) => void
}) {
  const store = useWorkspaceStore()
  const { tasks } = useWorkspaceState()
  const [quick, setQuick] = useState('')
  const [quickPriority, setQuickPriority] = useState<TaskPriority>('medium')
  const [adding, setAdding] = useState(false)
  const visible = useMemo(() => filterTasks(tasks, filters, today), [tasks, filters, today])
  const summary = useMemo(() => summarizeTasks(tasks, today), [tasks, today])
  const categories = useMemo(() => categoryOptions(DEFAULT_TASK_CATEGORIES, tasks.map((t) => t.category)), [tasks])
  const id = useId()
  const filtered = filters.query || filters.priority !== 'all' || filters.due !== 'all' || filters.category !== 'all' || filters.status !== 'open'

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = quick.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      // A day picked in the calendar/filter becomes the due date.
      const dueDate = filters.due === 'date' ? filters.date : filters.due === 'today' ? today : null
      const created = await store.createTask({ title, priority: quickPriority, dueDate })
      if (created) setQuick('')
    } finally {
      setAdding(false)
    }
  }

  const chip = (key: TaskDueFilter, label: string, count: number, tone: string) => (
    <button
      type="button"
      onClick={() => onFilters({ due: filters.due === key ? 'all' : key, status: 'open', date: null })}
      aria-pressed={filters.due === key}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', filters.due === key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent')}
    >
      <span className={cn('size-2 rounded-full', tone)} aria-hidden="true" />
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      <form onSubmit={quickAdd} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm" aria-label="เพิ่มงานด่วน">
        <label htmlFor={`${id}-quick`} className="sr-only">
          ชื่องานใหม่
        </label>
        <Input id={`${id}-quick`} value={quick} maxLength={300} onChange={(e) => setQuick(e.target.value)} placeholder={filters.due === 'date' && filters.date ? `เพิ่มงานครบกำหนด ${formatThaiDate(filters.date, today)}…` : 'พิมพ์งานใหม่แล้วกด Enter'} className="min-w-48 flex-1" data-testid="task-quick-input" />
        <NativeSelect aria-label="ระดับความสำคัญของงานใหม่" value={quickPriority} onChange={(e) => setQuickPriority(e.target.value as TaskPriority)} className="w-28">
          {TASK_PRIORITIES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" disabled={!quick.trim() || adding} data-testid="task-quick-add">
          {adding ? <Loader2 className="animate-spin" /> : <Plus />}
          เพิ่ม
        </Button>
        <Button type="button" variant="outline" onClick={() => onCreate(filters.due === 'date' && filters.date ? { dueDate: filters.date } : undefined)}>
          รายละเอียดเพิ่มเติม
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {chip('overdue', 'เลยกำหนด', summary.overdue, 'bg-red-500')}
        {chip('today', 'วันนี้', summary.dueToday, 'bg-orange-500')}
        {chip('week', '7 วันข้างหน้า', tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 6)).length, 'bg-primary')}
        {filters.due === 'date' && filters.date && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            ครบกำหนด {formatThaiDate(filters.date, today)}
            <button type="button" onClick={() => onFilters({ due: 'all', date: null })} aria-label="ล้างวันที่ที่เลือก" className="rounded-full p-0.5 hover:bg-primary/15">
              <X className="size-3" />
            </button>
          </span>
        )}
        <span className="ml-auto">
          <Segmented
            label="มุมมองงาน"
            value={view}
            onChange={onView}
            options={[
              { key: 'list', label: 'รายการ' },
              { key: 'matrix', label: 'เมทริกซ์' },
            ]}
          />
        </span>
      </div>

      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4" aria-label="รายการงาน">
        {view === 'list' && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_repeat(4,auto)]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor={`${id}-search`} className="sr-only">
                ค้นหางาน
              </label>
              <Input id={`${id}-search`} type="search" value={filters.query} onChange={(e) => onFilters({ query: e.target.value })} placeholder="ค้นหางาน" className="pl-9" />
            </div>
            <NativeSelect aria-label="กรองสถานะ" value={filters.status} onChange={(e) => onFilters({ status: e.target.value as TaskStatusFilter })}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="กรองระดับความสำคัญ" value={filters.priority} onChange={(e) => onFilters({ priority: e.target.value as TaskFilters['priority'] })}>
              <option value="all">ทุกระดับ</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p.key} value={p.key}>
                  ความสำคัญ{p.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="กรองวันครบกำหนด" value={filters.due === 'date' ? 'all' : filters.due} onChange={(e) => onFilters({ due: e.target.value as TaskDueFilter, date: null })}>
              {DUE_FILTERS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
            <div className="flex gap-2">
              <NativeSelect aria-label="กรองหมวดหมู่งาน" value={filters.category} onChange={(e) => onFilters({ category: e.target.value })} className="min-w-0 flex-1">
                <option value="all">ทุกหมวดหมู่</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="เรียงงาน" value={filters.sort} onChange={(e) => onFilters({ sort: e.target.value as TaskSort })} className="min-w-0 flex-1">
                {TASK_SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}

        {loading ? (
          <ListSkeleton label="กำลังโหลดงาน" />
        ) : view === 'matrix' ? (
          <PriorityMatrix tasks={tasks} today={today} onOpen={onOpen} onAdd={(q: Quadrant) => onCreate(quadrantFlags(q))} />
        ) : visible.length === 0 ? (
          tasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="ยังไม่มีงาน" description="พิมพ์งานในช่องด้านบนแล้วกด Enter เพื่อเริ่มต้น" />
          ) : (
            <EmptyState
              compact
              icon={filters.due === 'overdue' ? CalendarX2 : Search}
              title={filters.due === 'overdue' ? 'ไม่มีงานเลยกำหนด เยี่ยมมาก!' : 'ไม่พบงานที่ตรงกับตัวกรอง'}
              action={
                filtered ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onFilters({ query: '', status: 'open', priority: 'all', due: 'all', date: null, category: 'all' })}>
                    ล้างตัวกรอง
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <p className="mb-1 text-xs text-muted-foreground" aria-live="polite">
              {visible.length} งาน
            </p>
            <ul data-testid="task-list">
              {visible.map((t) => (
                <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} showStatus />
              ))}
            </ul>
          </>
        )}
      </section>
      {view === 'matrix' && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Grid2x2 className="size-3.5" aria-hidden="true" />ลากงานไปยังช่องอื่น หรือใช้เมนู ⋮ ของงานเพื่อย้ายช่อง — ช่องในเมทริกซ์แยกจากระดับความสำคัญ</p>}
      {view === 'list' && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><List className="size-3.5" aria-hidden="true" />กดชื่องานเพื่อดูรายละเอียด แก้ไข หรือลบ</p>}
    </div>
  )
}
