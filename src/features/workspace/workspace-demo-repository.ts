import { addDays, todayKey } from './workspace-dates'
import type { LinkInput, NotePatch, TaskInput, WorkspaceData, WorkspaceLink, WorkspaceNote, WorkspaceRepository, WorkspaceTask } from './workspace-types'

/**
 * Demo Mode (no Supabase configured) only: an in-memory workspace with a
 * few example records, kept for the browser session. Real mode never
 * uses this — see workspace-service.ts.
 */

const clone = <T>(v: T): T => structuredClone(v)
const nowIso = () => new Date().toISOString()

function seed(): WorkspaceData {
  const today = todayKey()
  const at = (daysAgo: number, hour = 9) => new Date(Date.now() - daysAgo * 86_400_000 - hour * 60_000).toISOString()
  const task = (p: Partial<WorkspaceTask> & { id: string; title: string }, i: number): WorkspaceTask => ({
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    startDate: null,
    category: null,
    important: false,
    urgent: false,
    sortOrder: i * 1024,
    completedAt: null,
    createdAt: at(5 - i),
    updatedAt: at(2),
    ...p,
  })
  return {
    tasks: [
      task({ id: 'demo-task-1', title: 'ส่งรายงานโครงการสถานศึกษาปลอดภัย', priority: 'high', dueDate: today, important: true, urgent: true, category: 'งานโครงการ' }, 0),
      task({ id: 'demo-task-2', title: 'ตรวจงานนักเรียน ม.2/1', priority: 'high', dueDate: today, status: 'in_progress', important: true, urgent: true, category: 'การสอน' }, 1),
      task({ id: 'demo-task-3', title: 'เตรียมสื่อการสอน เรื่อง การออมและการลงทุน', dueDate: addDays(today, 1), important: true, category: 'การสอน' }, 2),
      task({ id: 'demo-task-4', title: 'ประสานงานกิจกรรมวันลอยกระทง', priority: 'low', dueDate: addDays(today, 3), urgent: true }, 3),
      task({ id: 'demo-task-5', title: 'จัดระเบียบลิงก์การสอน', priority: 'low', dueDate: addDays(today, 10) }, 4),
      task({ id: 'demo-task-6', title: 'ส่งแบบประเมินครูผู้ช่วย', priority: 'high', dueDate: addDays(today, -2), important: true, urgent: true, category: 'งานธุรการ' }, 5),
      task({ id: 'demo-task-7', title: 'ประชุมกลุ่มสาระสังคมศึกษา', status: 'done', dueDate: today, completedAt: nowIso(), category: 'ประชุม' }, 6),
    ],
    notes: [
      { id: 'demo-note-1', title: 'ไอเดียกิจกรรม ม.2', body: 'ให้นักเรียนวิเคราะห์ปัจจัยการผลิตจากสินค้าท้องถิ่นในอำเภอ\nแบ่งกลุ่มละ 5 คน นำเสนอสัปดาห์หน้า', category: 'ไอเดีย', tags: ['ม.2', 'กิจกรรม'], pinned: true, archivedAt: null, revision: 1, createdAt: at(3), updatedAt: at(0, 60) },
      { id: 'demo-note-2', title: 'สรุปประชุมกลุ่มสาระ', body: 'กำหนดส่งแผนการสอน 15 พ.ย.\nดูรายละเอียด https://www.obec.go.th/', category: 'ประชุม', tags: [], pinned: false, archivedAt: null, revision: 1, createdAt: at(6), updatedAt: at(1) },
    ],
    links: [
      { id: 'demo-link-1', title: 'Google Drive – เอกสารการสอน', url: 'https://drive.google.com/', description: '', category: 'เอกสารการสอน', pinned: true, openCount: 12, lastOpenedAt: at(0, 30), createdAt: at(20), updatedAt: at(0, 30) },
      { id: 'demo-link-2', title: 'Canva – ออกแบบใบงาน', url: 'https://www.canva.com/', description: 'ทำใบงานและสไลด์', category: 'สื่อการเรียนรู้', pinned: false, openCount: 5, lastOpenedAt: at(1), createdAt: at(15), updatedAt: at(1) },
      { id: 'demo-link-3', title: 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน', url: 'https://www.obec.go.th/', description: '', category: 'เว็บไซต์ราชการ', pinned: false, openCount: 2, lastOpenedAt: at(4), createdAt: at(10), updatedAt: at(4) },
    ],
  }
}

let db: WorkspaceData | null = null
const data = () => (db ??= seed())

const delay = () => new Promise<void>((r) => setTimeout(r, 120))

function mustFind<T extends { id: string }>(list: T[], id: string): T {
  const row = list.find((r) => r.id === id)
  if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
  return row
}

export function resetDemoWorkspace() {
  db = null
}

export const demoWorkspaceRepository: WorkspaceRepository = {
  async load() {
    await delay()
    return clone(data())
  },

  async createNote(id, input: NotePatch) {
    await delay()
    const existing = data().notes.find((n) => n.id === id)
    if (existing) return clone(existing)
    const t = nowIso()
    const note: WorkspaceNote = { id, title: '', body: '', category: null, tags: [], pinned: false, archivedAt: null, ...input, revision: 1, createdAt: t, updatedAt: t }
    data().notes.push(note)
    return clone(note)
  },

  async updateNote(id, patch, expectedRevision) {
    await delay()
    const note = data().notes.find((n) => n.id === id)
    if (!note || (expectedRevision !== undefined && note.revision !== expectedRevision)) return { ok: false, reason: 'conflict', latest: note ? clone(note) : null }
    Object.assign(note, patch, { revision: note.revision + 1, updatedAt: nowIso() })
    return { ok: true, note: clone(note) }
  },

  async deleteNote(id) {
    await delay()
    data().notes = data().notes.filter((n) => n.id !== id)
  },

  async createLink(id, input: LinkInput) {
    await delay()
    const existing = data().links.find((l) => l.id === id)
    if (existing) return clone(existing)
    const t = nowIso()
    const link: WorkspaceLink = { id, description: '', category: null, pinned: false, ...input, openCount: 0, lastOpenedAt: null, createdAt: t, updatedAt: t }
    data().links.push(link)
    return clone(link)
  },

  async updateLink(id, patch) {
    await delay()
    const link = mustFind(data().links, id)
    Object.assign(link, patch, { updatedAt: nowIso() })
    return clone(link)
  },

  async deleteLink(id) {
    await delay()
    data().links = data().links.filter((l) => l.id !== id)
  },

  async linkOpened(id) {
    const link = data().links.find((l) => l.id === id)
    if (link) Object.assign(link, { openCount: link.openCount + 1, lastOpenedAt: nowIso() })
  },

  async createTask(id, input: TaskInput) {
    await delay()
    const existing = data().tasks.find((t) => t.id === id)
    if (existing) return clone(existing)
    const t = nowIso()
    const task: WorkspaceTask = { id, description: '', status: 'todo', priority: 'medium', dueDate: null, startDate: null, category: null, important: false, urgent: false, sortOrder: 0, ...input, completedAt: input.status === 'done' ? t : null, createdAt: t, updatedAt: t }
    data().tasks.push(task)
    return clone(task)
  },

  async updateTask(id, patch) {
    await delay()
    const task = mustFind(data().tasks, id)
    const wasDone = task.status === 'done'
    Object.assign(task, patch, { updatedAt: nowIso() })
    if (task.status !== 'done') task.completedAt = null
    else if (!wasDone || !task.completedAt) task.completedAt = nowIso()
    return clone(task)
  },

  async deleteTask(id) {
    await delay()
    data().tasks = data().tasks.filter((t) => t.id !== id)
  },
}
