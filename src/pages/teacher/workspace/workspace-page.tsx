import { Briefcase, CalendarDays, Database, Home, KanbanSquare, Link2, ListTodo, StickyNote, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { KanbanBoard } from '@/features/workspace/kanban-board'
import { LinkDialog, LinksPanel } from '@/features/workspace/links-panel'
import { NotesPanel } from '@/features/workspace/notes-panel'
import { OverviewPanel, type OverviewActions } from '@/features/workspace/overview-panel'
import { TaskDialog, type TaskDialogTarget } from '@/features/workspace/task-dialog'
import { TasksPanel, type TaskView } from '@/features/workspace/tasks-panel'
import { CalendarView } from '@/features/workspace/workspace-calendar'
import { WorkspaceProvider } from '@/features/workspace/workspace-context'
import { useWorkspaceState, useWorkspaceStore } from '@/features/workspace/workspace-hooks'
import { isDateKey, todayKey } from '@/features/workspace/workspace-dates'
import { DEFAULT_LINK_CATEGORIES } from '@/features/workspace/workspace-links-model'
import { categoryOptions, DEFAULT_TASK_FILTERS, type TaskFilters } from '@/features/workspace/workspace-tasks-model'
import type { TaskInput } from '@/features/workspace/workspace-types'
import { ErrorState } from '@/features/workspace/workspace-ui'

type WorkspaceTab = 'overview' | 'notes' | 'links' | 'tasks' | 'calendar' | 'kanban'

const WORKSPACE_TABS: { key: WorkspaceTab; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: 'ภาพรวม', icon: Home },
  { key: 'notes', label: 'บันทึก', icon: StickyNote },
  { key: 'links', label: 'ลิงก์โปรด', icon: Link2 },
  { key: 'tasks', label: 'งานของฉัน', icon: ListTodo },
  { key: 'calendar', label: 'ปฏิทิน', icon: CalendarDays },
  { key: 'kanban', label: 'กระดานงาน (Kanban)', icon: KanbanSquare },
]

const isTab = (v: string | null): v is WorkspaceTab => WORKSPACE_TABS.some((t) => t.key === v)

/** The Bangkok "today", refreshed each minute so it rolls over at midnight. */
function useToday(): string {
  const [today, setToday] = useState(() => todayKey())
  useEffect(() => {
    const timer = setInterval(() => setToday(todayKey()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

/** /teacher/workspace — พื้นที่ทำงานของฉัน (teacher-only; see ProtectedRoute and 0033's RLS). */
export function WorkspacePage() {
  return (
    <WorkspaceProvider>
      <WorkspaceScreen />
    </WorkspaceProvider>
  )
}

function WorkspaceScreen() {
  const store = useWorkspaceStore()
  const state = useWorkspaceState()
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const tab: WorkspaceTab = isTab(params.get('tab')) ? (params.get('tab') as WorkspaceTab) : 'overview'
  const noteId = params.get('note')
  const dateParam = params.get('date')
  const pickedDate = isDateKey(dateParam) ? dateParam : null
  const taskView: TaskView = params.get('view') === 'matrix' ? 'matrix' : 'list'

  const [taskFilters, setTaskFilters] = useState<TaskFilters>(() => (pickedDate ? { ...DEFAULT_TASK_FILTERS, due: 'date', date: pickedDate } : DEFAULT_TASK_FILTERS))
  const [taskDialog, setTaskDialog] = useState<TaskDialogTarget | null>(() => (params.get('task') ? { taskId: params.get('task')! } : null))
  const [linkDialog, setLinkDialog] = useState<'new' | null>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const loading = state.status === 'loading'

  const go = useCallback(
    (next: WorkspaceTab, extra: Record<string, string | null> = {}, options: { replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set('tab', next)
          for (const key of ['note', 'date', 'view', 'task']) if (!(key in extra)) p.delete(key)
          for (const [k, v] of Object.entries(extra)) {
            if (v === null) p.delete(k)
            else p.set(k, v)
          }
          if (next === 'overview') p.delete('tab')
          return p
        },
        { replace: options.replace ?? false },
      )
    },
    [setParams],
  )

  const openTask = useCallback((id: string) => setTaskDialog({ taskId: id }), [])
  const createTask = useCallback((defaults?: Partial<TaskInput>) => setTaskDialog({ defaults }), [])
  const createNote = useCallback(() => go('notes', { note: store.createNote().id }), [store, go])

  const overviewActions: OverviewActions = useMemo(
    () => ({
      openTask,
      createTask,
      showTasks: (shortcut) => {
        if (shortcut === 'matrix') return go('tasks', { view: 'matrix' })
        const base = { ...DEFAULT_TASK_FILTERS }
        if (typeof shortcut === 'object') {
          setTaskFilters({ ...base, status: 'all', due: 'date', date: shortcut.date })
          return go('tasks', { date: shortcut.date })
        }
        if (shortcut === 'high') setTaskFilters({ ...base, priority: 'high' })
        else if (shortcut === 'done') setTaskFilters({ ...base, status: 'done', sort: 'updated' })
        else setTaskFilters({ ...base, due: shortcut })
        go('tasks')
      },
      openNote: (id) => go('notes', id ? { note: id } : {}),
      createNote,
      showLinks: () => go('links'),
      addLink: () => setLinkDialog('new'),
      showCalendar: (date) => go('calendar', date ? { date } : {}),
    }),
    [openTask, createTask, go, createNote],
  )

  // A ?date= in the URL (calendar pick, bookmark) filters the task list.
  const effectiveTaskFilters: TaskFilters = tab === 'tasks' && pickedDate ? { ...taskFilters, status: taskFilters.due === 'date' && taskFilters.date === pickedDate ? taskFilters.status : 'all', due: 'date', date: pickedDate } : taskFilters

  // Phones: keep the selected tab in view in the scrolling tab bar.
  useEffect(() => {
    tabRefs.current[WORKSPACE_TABS.findIndex((t) => t.key === tab)]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  const counts: Partial<Record<WorkspaceTab, number>> = state.status === 'ready' ? { notes: state.notes.filter((n) => !n.archivedAt).length, links: state.links.length, tasks: state.tasks.filter((t) => t.status !== 'done').length } : {}
  const linkCategories = useMemo(() => categoryOptions(DEFAULT_LINK_CATEGORIES, state.links.map((l) => l.category)), [state.links])
  const panelId = 'workspace-panel'

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex items-center gap-3 sm:gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#285a99] text-white shadow-md sm:size-14" aria-hidden="true">
          <Briefcase className="size-6 sm:size-7" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">พื้นที่ทำงานของฉัน</h1>
          <p className="text-sm text-muted-foreground">จัดการบันทึก ลิงก์ งาน และตารางเวลาในที่เดียว</p>
        </div>
      </header>

      <div role="tablist" aria-label="ส่วนของพื้นที่ทำงาน" className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-sm">
        {WORKSPACE_TABS.map((t, index) => {
          const selected = t.key === tab
          const Icon = t.icon
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={`workspace-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => go(t.key)}
              onKeyDown={(e) => {
                const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                const target = e.key === 'Home' ? 0 : e.key === 'End' ? WORKSPACE_TABS.length - 1 : delta ? (index + delta + WORKSPACE_TABS.length) % WORKSPACE_TABS.length : null
                if (target === null) return
                e.preventDefault()
                go(WORKSPACE_TABS[target].key)
                tabRefs.current[target]?.focus()
              }}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:px-4',
                selected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              data-testid={`workspace-tab-${t.key}`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t.label}
              {typeof counts[t.key] === 'number' && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', selected ? 'bg-white/20' : 'bg-muted')}>{counts[t.key]}</span>}
            </button>
          )
        })}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`workspace-tab-${tab}`} tabIndex={-1}>
        {state.status === 'not_installed' ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/8 px-6 py-10 text-center" role="alert" data-testid="workspace-not-installed">
            <Database className="size-8 text-amber-600" aria-hidden="true" />
            <p className="font-semibold text-foreground">พื้นที่ทำงานยังไม่พร้อมใช้งาน</p>
            <p className="max-w-lg text-sm text-muted-foreground">{state.error}</p>
          </div>
        ) : state.status === 'error' ? (
          <ErrorState message={state.error ?? 'โหลดพื้นที่ทำงานไม่สำเร็จ'} onRetry={() => void store.load()} />
        ) : tab === 'overview' ? (
          <OverviewPanel today={today} loading={loading} actions={overviewActions} />
        ) : tab === 'notes' ? (
          <NotesPanel loading={loading} selectedId={noteId} onSelect={(id) => go('notes', id ? { note: id } : {})} />
        ) : tab === 'links' ? (
          <LinksPanel loading={loading} />
        ) : tab === 'tasks' ? (
          <TasksPanel
            filters={effectiveTaskFilters}
            onFilters={(patch) => {
              setTaskFilters((f) => ({ ...f, ...patch }))
              if ('date' in patch && !patch.date && pickedDate) go('tasks', {})
            }}
            view={taskView}
            onView={(v) => go('tasks', { view: v === 'matrix' ? 'matrix' : null })}
            today={today}
            loading={loading}
            onOpen={openTask}
            onCreate={createTask}
          />
        ) : tab === 'calendar' ? (
          <CalendarView tasks={state.tasks} today={today} selected={pickedDate ?? today} onSelect={(date) => go('calendar', { date }, { replace: true })} onOpen={openTask} onCreate={(date) => createTask({ dueDate: date })} />
        ) : (
          <KanbanBoard tasks={state.tasks} today={today} onOpen={openTask} onAdd={(status) => createTask({ status })} />
        )}
      </div>

      <TaskDialog target={state.status === 'ready' ? taskDialog : null} onClose={() => setTaskDialog(null)} />
      <LinkDialog target={linkDialog} categories={linkCategories} onClose={() => setLinkDialog(null)} />
    </div>
  )
}
