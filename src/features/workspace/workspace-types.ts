/**
 * พื้นที่ทำงานของฉัน — the teacher's private notes, links and tasks
 * (supabase/migrations/0033_teacher_workspace.sql). Every view of tasks
 * (list, Eisenhower matrix, calendar, Kanban) reads the same
 * WorkspaceTask records.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'high' | 'medium' | 'low'

export interface WorkspaceTask {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** Calendar day 'YYYY-MM-DD' (Asia/Bangkok), no time part. */
  dueDate: string | null
  startDate: string | null
  category: string | null
  important: boolean
  urgent: boolean
  /** Position inside its Kanban column (lower first). */
  sortOrder: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceNote {
  id: string
  title: string
  body: string
  category: string | null
  tags: string[]
  pinned: boolean
  archivedAt: string | null
  /** Bumped by the server on every update (stale-save protection). */
  revision: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceLink {
  id: string
  title: string
  url: string
  description: string
  category: string | null
  pinned: boolean
  openCount: number
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
}

export type TaskFields = Pick<WorkspaceTask, 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'startDate' | 'category' | 'important' | 'urgent' | 'sortOrder'>
export type TaskPatch = Partial<TaskFields>
export type TaskInput = Partial<TaskFields> & { title: string }

export type NoteFields = Pick<WorkspaceNote, 'title' | 'body' | 'category' | 'tags' | 'pinned' | 'archivedAt'>
export type NotePatch = Partial<NoteFields>

export type LinkFields = Pick<WorkspaceLink, 'title' | 'url' | 'description' | 'category' | 'pinned'>
export type LinkPatch = Partial<LinkFields>
export type LinkInput = Partial<LinkFields> & { title: string; url: string }

export interface WorkspaceData {
  notes: WorkspaceNote[]
  links: WorkspaceLink[]
  tasks: WorkspaceTask[]
}

export type NoteSaveResult =
  | { ok: true; note: WorkspaceNote }
  /** Someone (another tab/device) saved first; `latest` is null if the note was deleted. */
  | { ok: false; reason: 'conflict'; latest: WorkspaceNote | null }

/**
 * Storage behind the workspace — Supabase in real mode, in-memory in
 * Demo Mode. Create calls take a client-generated id so a retried
 * request never makes a second record.
 */
export interface WorkspaceRepository {
  load(): Promise<WorkspaceData>
  createNote(id: string, input: NotePatch): Promise<WorkspaceNote>
  /** With `expectedRevision`, saves only if nobody saved since. */
  updateNote(id: string, patch: NotePatch, expectedRevision?: number): Promise<NoteSaveResult>
  deleteNote(id: string): Promise<void>
  createLink(id: string, input: LinkInput): Promise<WorkspaceLink>
  updateLink(id: string, patch: LinkPatch): Promise<WorkspaceLink>
  deleteLink(id: string): Promise<void>
  linkOpened(id: string): Promise<void>
  createTask(id: string, input: TaskInput): Promise<WorkspaceTask>
  updateTask(id: string, patch: TaskPatch): Promise<WorkspaceTask>
  deleteTask(id: string): Promise<void>
}

/** 0033 is not installed in this database yet. */
export class WorkspaceNotInstalledError extends Error {
  constructor() {
    super('ยังไม่ได้ติดตั้งฐานข้อมูลของพื้นที่ทำงาน (migration 0033) กรุณาติดต่อผู้ดูแลระบบ')
    this.name = 'WorkspaceNotInstalledError'
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Fallback (old browsers): RFC 4122 v4 from Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
