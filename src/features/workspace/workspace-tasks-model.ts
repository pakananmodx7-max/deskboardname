import { addDays, bangkokDateKey, diffDays } from './workspace-dates'
import type { TaskPatch, TaskPriority, TaskStatus, WorkspaceTask } from './workspace-types'

export const TASK_STATUSES: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'ยังไม่เริ่ม' },
  { key: 'in_progress', label: 'กำลังดำเนินการ' },
  { key: 'done', label: 'เสร็จแล้ว' },
]

export const TASK_PRIORITIES: { key: TaskPriority; label: string }[] = [
  { key: 'high', label: 'สูง' },
  { key: 'medium', label: 'ปานกลาง' },
  { key: 'low', label: 'ต่ำ' },
]

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'ยังไม่เริ่ม', in_progress: 'กำลังดำเนินการ', done: 'เสร็จแล้ว' }
export const PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' }
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

export const DEFAULT_TASK_CATEGORIES = ['การสอน', 'งานธุรการ', 'งานโครงการ', 'ประชุม', 'ส่วนตัว']

/** "Approaching" = due within this many days after today. */
export const SOON_DAYS = 3

// ==================================================
// Eisenhower matrix — from the important/urgent flags only (never from
// priority: the two are separate concepts).
// ==================================================

export type Quadrant = 'do' | 'plan' | 'delegate' | 'later'

export const QUADRANTS: { key: Quadrant; title: string; action: string; important: boolean; urgent: boolean }[] = [
  { key: 'do', title: 'สำคัญ + เร่งด่วน', action: 'ทำทันที', important: true, urgent: true },
  { key: 'plan', title: 'สำคัญ + ไม่เร่งด่วน', action: 'วางแผนทำ', important: true, urgent: false },
  { key: 'delegate', title: 'ไม่สำคัญ + เร่งด่วน', action: 'จัดการหรือมอบหมาย', important: false, urgent: true },
  { key: 'later', title: 'ไม่สำคัญ + ไม่เร่งด่วน', action: 'ทำภายหลัง', important: false, urgent: false },
]

export function quadrantOf(task: Pick<WorkspaceTask, 'important' | 'urgent'>): Quadrant {
  if (task.important) return task.urgent ? 'do' : 'plan'
  return task.urgent ? 'delegate' : 'later'
}

export function quadrantFlags(quadrant: Quadrant): { important: boolean; urgent: boolean } {
  const q = QUADRANTS.find((x) => x.key === quadrant)!
  return { important: q.important, urgent: q.urgent }
}

export function groupByQuadrant(tasks: WorkspaceTask[]): Record<Quadrant, WorkspaceTask[]> {
  const out: Record<Quadrant, WorkspaceTask[]> = { do: [], plan: [], delegate: [], later: [] }
  for (const t of tasks) if (t.status !== 'done') out[quadrantOf(t)].push(t)
  for (const key of Object.keys(out) as Quadrant[]) out[key] = sortTasks(out[key], 'due')
  return out
}

// ==================================================
// Due state
// ==================================================

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later' | 'none'

export function dueState(task: Pick<WorkspaceTask, 'status' | 'dueDate'>, today: string): DueState {
  if (task.status === 'done') return 'done'
  if (!task.dueDate) return 'none'
  const d = diffDays(today, task.dueDate)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d <= SOON_DAYS) return 'soon'
  return 'later'
}

export interface TaskSummary {
  /** Not done. */
  pending: number
  /** Not done and priority สูง. */
  highPriority: number
  /** Not done, due today or within SOON_DAYS (overdue not included). */
  dueSoon: number
  dueToday: number
  overdue: number
  done: number
}

export function summarizeTasks(tasks: WorkspaceTask[], today: string): TaskSummary {
  const s: TaskSummary = { pending: 0, highPriority: 0, dueSoon: 0, dueToday: 0, overdue: 0, done: 0 }
  for (const t of tasks) {
    if (t.status === 'done') {
      s.done += 1
      continue
    }
    s.pending += 1
    if (t.priority === 'high') s.highPriority += 1
    const state = dueState(t, today)
    if (state === 'overdue') s.overdue += 1
    if (state === 'today') s.dueToday += 1
    if (state === 'today' || state === 'soon') s.dueSoon += 1
  }
  return s
}

/**
 * งานที่ต้องจัดการวันนี้: open tasks that are overdue or due today, plus
 * the ones finished today (so ticking one off keeps it visible, struck
 * through). Open first, then by due date and priority.
 */
export function todayTasks(tasks: WorkspaceTask[], today: string): WorkspaceTask[] {
  const open = tasks.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate <= today)
  const doneToday = tasks.filter((t) => t.status === 'done' && t.completedAt !== null && bangkokDateKey(t.completedAt) === today)
  return [...sortTasks(open, 'due'), ...sortTasks(doneToday, 'updated')]
}

/** Open tasks due after today within `days`, soonest first. */
export function upcomingTasks(tasks: WorkspaceTask[], today: string, days = 14): WorkspaceTask[] {
  const end = addDays(today, days)
  return sortTasks(
    tasks.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate > today && t.dueDate <= end),
    'due',
  )
}

// ==================================================
// Filters and sorting
// ==================================================

export type TaskStatusFilter = 'all' | 'open' | TaskStatus
export type TaskDueFilter = 'all' | 'overdue' | 'today' | 'week' | 'upcoming' | 'none' | 'date'
export type TaskSort = 'due' | 'priority' | 'updated' | 'created' | 'title'

export interface TaskFilters {
  query: string
  status: TaskStatusFilter
  priority: 'all' | TaskPriority
  due: TaskDueFilter
  /** For due = 'date'. */
  date: string | null
  category: 'all' | string
  sort: TaskSort
}

export const DEFAULT_TASK_FILTERS: TaskFilters = { query: '', status: 'open', priority: 'all', due: 'all', date: null, category: 'all', sort: 'due' }

export const TASK_SORTS: { key: TaskSort; label: string }[] = [
  { key: 'due', label: 'วันครบกำหนด' },
  { key: 'priority', label: 'ความสำคัญ' },
  { key: 'updated', label: 'แก้ไขล่าสุด' },
  { key: 'created', label: 'สร้างล่าสุด' },
  { key: 'title', label: 'ชื่องาน (ก-ฮ)' },
]

function matchesQuery(task: WorkspaceTask, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('th')
  if (!q) return true
  return [task.title, task.description, task.category ?? ''].some((v) => v.toLocaleLowerCase('th').includes(q))
}

function matchesDue(task: WorkspaceTask, filters: TaskFilters, today: string): boolean {
  switch (filters.due) {
    case 'all':
      return true
    case 'overdue':
      return dueState(task, today) === 'overdue'
    case 'today':
      return task.dueDate === today
    case 'week':
      return task.dueDate !== null && task.dueDate >= today && task.dueDate <= addDays(today, 6)
    case 'upcoming':
      return task.dueDate !== null && task.dueDate > today
    case 'none':
      return task.dueDate === null
    case 'date':
      return filters.date !== null && task.dueDate === filters.date
  }
}

export function filterTasks(tasks: WorkspaceTask[], filters: TaskFilters, today: string): WorkspaceTask[] {
  const result = tasks.filter((t) => {
    if (filters.status === 'open' ? t.status === 'done' : filters.status !== 'all' && t.status !== filters.status) return false
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false
    if (filters.category !== 'all' && (t.category ?? '') !== filters.category) return false
    return matchesDue(t, filters, today) && matchesQuery(t, filters.query)
  })
  return sortTasks(result, filters.sort)
}

const byText = (a: string, b: string) => a.localeCompare(b, 'th')

export function sortTasks(tasks: WorkspaceTask[], sort: TaskSort): WorkspaceTask[] {
  const copy = [...tasks]
  const due = (t: WorkspaceTask) => t.dueDate ?? '9999-12-31'
  copy.sort((a, b) => {
    switch (sort) {
      case 'due':
        return byText(due(a), due(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byText(a.createdAt, b.createdAt)
      case 'priority':
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byText(due(a), due(b))
      case 'updated':
        return byText(b.updatedAt, a.updatedAt)
      case 'created':
        return byText(b.createdAt, a.createdAt)
      case 'title':
        return byText(a.title, b.title)
    }
  })
  return copy
}

/** Due-date → tasks (every status), for the calendars. */
export function tasksByDate(tasks: WorkspaceTask[]): Map<string, WorkspaceTask[]> {
  const map = new Map<string, WorkspaceTask[]>()
  for (const t of tasks) {
    if (!t.dueDate) continue
    const list = map.get(t.dueDate)
    if (list) list.push(t)
    else map.set(t.dueDate, [t])
  }
  for (const [key, list] of map) map.set(key, sortTasks(list, 'priority').sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')))
  return map
}

export function categoriesInUse(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort(byText)
}

/** Built-in suggestions first, then the teacher's own, without duplicates. */
export function categoryOptions(defaults: string[], used: (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of [...defaults, ...categoriesInUse(used)]) {
    const key = c.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

// ==================================================
// Kanban ordering
// ==================================================

const ORDER_STEP = 1024

/** A column's tasks in board order. */
export function columnTasks(tasks: WorkspaceTask[], status: TaskStatus): WorkspaceTask[] {
  return tasks
    .filter((t) => t.status === status)
    .sort((a, b) => a.sortOrder - b.sortOrder || byText(a.createdAt, b.createdAt))
}

/** sortOrder for a new card at the end (or start) of a column. */
export function edgeSortOrder(tasks: WorkspaceTask[], status: TaskStatus, edge: 'start' | 'end'): number {
  const col = columnTasks(tasks, status)
  if (col.length === 0) return 0
  return edge === 'end' ? col[col.length - 1].sortOrder + ORDER_STEP : col[0].sortOrder - ORDER_STEP
}

/**
 * The updates that put `taskId` at `toIndex` of the `toStatus` column.
 * Normally one patch (the moved task, between its new neighbours); when
 * the neighbours are too close to split, the whole column is renumbered.
 */
export function planMove(tasks: WorkspaceTask[], taskId: string, toStatus: TaskStatus, toIndex: number): { id: string; patch: TaskPatch }[] {
  const moving = tasks.find((t) => t.id === taskId)
  if (!moving) return []
  const col = columnTasks(tasks, toStatus).filter((t) => t.id !== taskId)
  const index = Math.max(0, Math.min(toIndex, col.length))
  const before = col[index - 1]
  const after = col[index]
  let order: number
  if (!before && !after) order = 0
  else if (!before) order = after.sortOrder - ORDER_STEP
  else if (!after) order = before.sortOrder + ORDER_STEP
  else order = (before.sortOrder + after.sortOrder) / 2

  const unchanged = moving.status === toStatus && columnTasks(tasks, toStatus).findIndex((t) => t.id === taskId) === index
  if (unchanged) return []

  const tooClose = before && after && !(order > before.sortOrder && order < after.sortOrder && after.sortOrder - before.sortOrder > 1e-6)
  if (!tooClose) {
    const patch: TaskPatch = { sortOrder: order }
    if (moving.status !== toStatus) patch.status = toStatus
    return [{ id: taskId, patch }]
  }
  const ordered = [...col.slice(0, index), moving, ...col.slice(index)]
  return ordered.flatMap((t, i) => {
    const patch: TaskPatch = {}
    if (t.sortOrder !== i * ORDER_STEP) patch.sortOrder = i * ORDER_STEP
    if (t.id === taskId && t.status !== toStatus) patch.status = toStatus
    return Object.keys(patch).length ? [{ id: t.id, patch }] : []
  })
}

/** A status change made outside the board puts the card on top of its new column. */
export function statusChangePatch(tasks: WorkspaceTask[], task: WorkspaceTask, status: TaskStatus): TaskPatch {
  if (task.status === status) return {}
  return { status, sortOrder: edgeSortOrder(tasks.filter((t) => t.id !== task.id), status, 'start') }
}

// ==================================================
// Validation (mirrors the 0033 CHECK constraints)
// ==================================================

export function validateTaskFields(fields: { title: string; startDate: string | null; dueDate: string | null; description?: string; category?: string | null }): string | null {
  const title = fields.title.trim()
  if (!title) return 'กรุณาระบุชื่องาน'
  if (title.length > 300) return 'ชื่องานยาวเกิน 300 ตัวอักษร'
  if ((fields.description ?? '').length > 10000) return 'รายละเอียดยาวเกิน 10,000 ตัวอักษร'
  if (fields.category && fields.category.trim().length > 60) return 'ชื่อหมวดหมู่ยาวเกิน 60 ตัวอักษร'
  if (fields.startDate && fields.dueDate && fields.startDate > fields.dueDate) return 'วันเริ่มต้องไม่อยู่หลังวันครบกำหนด'
  return null
}
