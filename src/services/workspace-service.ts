import {
  WorkspaceNotInstalledError,
  type LinkPatch,
  type NotePatch,
  type NoteSaveResult,
  type TaskPatch,
  type WorkspaceData,
  type WorkspaceLink,
  type WorkspaceNote,
  type WorkspaceRepository,
  type WorkspaceTask,
} from '@/features/workspace/workspace-types'
import { getSupabaseClient } from '@/lib/supabase'
import { fetchAllPages, withTimeout } from '@/services/classroom-analytics-service'
import { isOptionalTableMissingError } from '@/services/student-portal-service'

/**
 * พื้นที่ทำงานของฉัน — Supabase storage (0033_teacher_workspace.sql).
 * RLS limits every query to the signed-in teacher's own rows and the
 * database sets owner_id itself, so nothing here sends an owner id.
 */

const REQUEST_TIMEOUT_MS = 15_000
const UNIQUE_VIOLATION = '23505'

interface NoteRow {
  id: string
  title: string
  body: string
  category: string | null
  tags: string[] | null
  pinned: boolean
  archived_at: string | null
  revision: number
  created_at: string
  updated_at: string
}

interface LinkRow {
  id: string
  title: string
  url: string
  description: string | null
  category: string | null
  pinned: boolean
  open_count: number
  last_opened_at: string | null
  created_at: string
  updated_at: string
}

interface TaskRow {
  id: string
  title: string
  description: string | null
  status: WorkspaceTask['status']
  priority: WorkspaceTask['priority']
  due_date: string | null
  start_date: string | null
  category: string | null
  important: boolean
  urgent: boolean
  sort_order: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

const NOTE_COLUMNS = 'id, title, body, category, tags, pinned, archived_at, revision, created_at, updated_at'
const LINK_COLUMNS = 'id, title, url, description, category, pinned, open_count, last_opened_at, created_at, updated_at'
const TASK_COLUMNS = 'id, title, description, status, priority, due_date, start_date, category, important, urgent, sort_order, completed_at, created_at, updated_at'

export function toNote(r: NoteRow): WorkspaceNote {
  return {
    id: r.id,
    title: r.title ?? '',
    body: r.body ?? '',
    category: r.category,
    tags: r.tags ?? [],
    pinned: r.pinned,
    archivedAt: r.archived_at,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function toLink(r: LinkRow): WorkspaceLink {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    description: r.description ?? '',
    category: r.category,
    pinned: r.pinned,
    openCount: r.open_count ?? 0,
    lastOpenedAt: r.last_opened_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function toTask(r: TaskRow): WorkspaceTask {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? '',
    status: r.status,
    priority: r.priority,
    // PostgREST returns `date` as 'YYYY-MM-DD' already; slice guards against a timestamp.
    dueDate: r.due_date ? r.due_date.slice(0, 10) : null,
    startDate: r.start_date ? r.start_date.slice(0, 10) : null,
    category: r.category,
    important: r.important,
    urgent: r.urgent,
    sortOrder: Number(r.sort_order) || 0,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const clean = (v: string | null | undefined) => {
  const t = v?.trim()
  return t ? t : null
}

export function noteToRow(p: NotePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.title !== undefined) row.title = p.title
  if (p.body !== undefined) row.body = p.body
  if (p.category !== undefined) row.category = clean(p.category)
  if (p.tags !== undefined) row.tags = p.tags
  if (p.pinned !== undefined) row.pinned = p.pinned
  if (p.archivedAt !== undefined) row.archived_at = p.archivedAt
  return row
}

export function linkToRow(p: LinkPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.title !== undefined) row.title = p.title.trim()
  if (p.url !== undefined) row.url = p.url
  if (p.description !== undefined) row.description = p.description
  if (p.category !== undefined) row.category = clean(p.category)
  if (p.pinned !== undefined) row.pinned = p.pinned
  return row
}

export function taskToRow(p: TaskPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.title !== undefined) row.title = p.title.trim()
  if (p.description !== undefined) row.description = p.description
  if (p.status !== undefined) row.status = p.status
  if (p.priority !== undefined) row.priority = p.priority
  if (p.dueDate !== undefined) row.due_date = p.dueDate
  if (p.startDate !== undefined) row.start_date = p.startDate
  if (p.category !== undefined) row.category = clean(p.category)
  if (p.important !== undefined) row.important = p.important
  if (p.urgent !== undefined) row.urgent = p.urgent
  if (p.sortOrder !== undefined) row.sort_order = p.sortOrder
  return row
}

function rethrow(error: unknown): never {
  if (isOptionalTableMissingError(error)) throw new WorkspaceNotInstalledError()
  throw error
}

type Table = 'workspace_notes' | 'workspace_links' | 'workspace_tasks'

async function loadAll<T>(table: Table, columns: string): Promise<T[]> {
  const supabase = getSupabaseClient()
  return fetchAllPages<T>((from, to) => supabase.from(table).select(columns).order('id').range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>)
}

async function selectOne<T>(table: Table, columns: string, id: string): Promise<T | null> {
  const { data, error } = await getSupabaseClient().from(table).select(columns).eq('id', id).maybeSingle()
  if (error) rethrow(error)
  return (data as T | null) ?? null
}

/** Insert with a client id; a retry whose first attempt did land returns that row. */
async function insertOne<T>(table: Table, columns: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await withTimeout(Promise.resolve(getSupabaseClient().from(table).insert(row).select(columns).single()), REQUEST_TIMEOUT_MS)
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const existing = await selectOne<T>(table, columns, row.id as string)
      if (existing) return existing
    }
    rethrow(error)
  }
  return data as T
}

async function updateOne<T>(table: Table, columns: string, id: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await withTimeout(Promise.resolve(getSupabaseClient().from(table).update(row).eq('id', id).select(columns).maybeSingle()), REQUEST_TIMEOUT_MS)
  if (error) rethrow(error)
  if (!data) throw new Error('ไม่พบรายการนี้แล้ว อาจถูกลบจากอุปกรณ์อื่น')
  return data as T
}

async function deleteOne(table: Table, id: string): Promise<void> {
  const { error } = await withTimeout(Promise.resolve(getSupabaseClient().from(table).delete().eq('id', id)), REQUEST_TIMEOUT_MS)
  if (error) rethrow(error)
}

export const supabaseWorkspaceRepository: WorkspaceRepository = {
  async load(): Promise<WorkspaceData> {
    try {
      const [notes, links, tasks] = await withTimeout(
        Promise.all([loadAll<NoteRow>('workspace_notes', NOTE_COLUMNS), loadAll<LinkRow>('workspace_links', LINK_COLUMNS), loadAll<TaskRow>('workspace_tasks', TASK_COLUMNS)]),
        30_000,
      )
      return { notes: notes.map(toNote), links: links.map(toLink), tasks: tasks.map(toTask) }
    } catch (error) {
      rethrow(error)
    }
  },

  async createNote(id, input) {
    return toNote(await insertOne<NoteRow>('workspace_notes', NOTE_COLUMNS, { id, ...noteToRow(input) }))
  },

  async updateNote(id, patch, expectedRevision): Promise<NoteSaveResult> {
    let query = getSupabaseClient().from('workspace_notes').update(noteToRow(patch)).eq('id', id)
    if (expectedRevision !== undefined) query = query.eq('revision', expectedRevision)
    const { data, error } = await withTimeout(Promise.resolve(query.select(NOTE_COLUMNS).maybeSingle()), REQUEST_TIMEOUT_MS)
    if (error) rethrow(error)
    if (data) return { ok: true, note: toNote(data as unknown as NoteRow) }
    const latest = await selectOne<NoteRow>('workspace_notes', NOTE_COLUMNS, id)
    return { ok: false, reason: 'conflict', latest: latest ? toNote(latest) : null }
  },

  deleteNote: (id) => deleteOne('workspace_notes', id),

  async createLink(id, input) {
    return toLink(await insertOne<LinkRow>('workspace_links', LINK_COLUMNS, { id, ...linkToRow(input) }))
  },

  async updateLink(id, patch) {
    return toLink(await updateOne<LinkRow>('workspace_links', LINK_COLUMNS, id, linkToRow(patch)))
  },

  deleteLink: (id) => deleteOne('workspace_links', id),

  async linkOpened(id) {
    const { error } = await getSupabaseClient().rpc('workspace_link_opened', { p_link_id: id })
    if (error) rethrow(error)
  },

  async createTask(id, input) {
    return toTask(await insertOne<TaskRow>('workspace_tasks', TASK_COLUMNS, { id, ...taskToRow(input) }))
  },

  async updateTask(id, patch) {
    return toTask(await updateOne<TaskRow>('workspace_tasks', TASK_COLUMNS, id, taskToRow(patch)))
  },

  deleteTask: (id) => deleteOne('workspace_tasks', id),
}
