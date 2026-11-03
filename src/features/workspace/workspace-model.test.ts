import { describe, expect, it } from 'vitest'

import { addDays, bangkokDateKey, diffDays, formatThaiDate, formatThaiDateLong, formatThaiMonth, isDateKey, monthGrid, relativeDayLabel, todayKey, weekDays } from './workspace-dates'
import { extractLinks, filterNotes, noteDisplayTitle, noteExcerpt, parseTags, recentNotes, DEFAULT_NOTE_FILTERS } from './workspace-notes-model'
import { filterLinks, hostLabel, normalizeLinkUrl, safeHref, DEFAULT_LINK_FILTERS } from './workspace-links-model'
import {
  categoryOptions,
  columnTasks,
  dueState,
  filterTasks,
  groupByQuadrant,
  planMove,
  quadrantFlags,
  quadrantOf,
  statusChangePatch,
  summarizeTasks,
  tasksByDate,
  todayTasks,
  upcomingTasks,
  validateTaskFields,
  DEFAULT_TASK_FILTERS,
} from './workspace-tasks-model'
import type { WorkspaceLink, WorkspaceNote, WorkspaceTask } from './workspace-types'

const T = '2026-11-03'

function task(p: Partial<WorkspaceTask> & { id: string }): WorkspaceTask {
  return {
    title: p.id,
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    startDate: null,
    category: null,
    important: false,
    urgent: false,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...p,
  }
}

describe('workspace dates — Asia/Bangkok, no off-by-one', () => {
  it('today is the Bangkok day, not the UTC day', () => {
    // 2026-11-02 18:30 UTC is already 2026-11-03 01:30 in Bangkok.
    expect(todayKey(new Date('2026-11-02T18:30:00Z'))).toBe('2026-11-03')
    // 2026-11-03 16:59 UTC is still 23:59 on the 3rd in Bangkok.
    expect(bangkokDateKey('2026-11-03T16:59:00Z')).toBe('2026-11-03')
    expect(bangkokDateKey('2026-11-03T17:00:00Z')).toBe('2026-11-04')
  })

  it('day arithmetic crosses months, years and leap days', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2026-11-03', '2026-11-10')).toBe(7)
    expect(diffDays('2026-11-03', '2026-10-31')).toBe(-3)
  })

  it('validates date keys', () => {
    expect(isDateKey('2026-11-03')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('2026-11-3')).toBe(false)
    expect(isDateKey(null)).toBe(false)
  })

  it('month grid: 42 Sunday-first days covering the month', () => {
    const grid = monthGrid(2026, 11)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBe('2026-11-01') // 1 Nov 2026 is a Sunday
    expect(grid).toContain('2026-11-30')
    const feb = monthGrid(2026, 2)
    expect(feb[0]).toBe('2026-02-01') // a Sunday too
    expect(weekDays('2026-11-04')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
  })

  it('formats Thai (Buddhist-era) dates for the day stored, never the neighbour', () => {
    expect(formatThaiDate('2026-11-03', T)).toBe('3 พ.ย.')
    expect(formatThaiDate('2027-01-01', T)).toBe('1 ม.ค. 2570')
    expect(formatThaiMonth(2026, 11)).toBe('พฤศจิกายน 2569')
    expect(formatThaiDateLong('2026-11-30')).toContain('30 พฤศจิกายน 2569')
    expect(relativeDayLabel('2026-11-03', T)).toBe('วันนี้')
    expect(relativeDayLabel('2026-11-04', T)).toBe('พรุ่งนี้')
    expect(relativeDayLabel('2026-11-01', T)).toBe('เลยมา 2 วัน')
    expect(relativeDayLabel('2026-11-06', T)).toBe('อีก 3 วัน')
  })
})

describe('links — only safe http(s) URLs', () => {
  it.each([
    ['https://drive.google.com/x', 'https://drive.google.com/x'],
    ['  http://www.sesao.kpp.go.th  ', 'http://www.sesao.kpp.go.th/'],
    ['www.canva.com', 'https://www.canva.com/'],
    ['canva.com/design?a=1', 'https://canva.com/design?a=1'],
    ['localhost:5173/x', 'https://localhost:5173/x'],
    ['HTTPS://Example.com', 'https://example.com/'],
  ])('accepts %s', (raw, expected) => {
    expect(normalizeLinkUrl(raw)).toEqual({ ok: true, url: expected })
  })

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://a.example', 'mailto:a@b.c', 'https://user:pw@evil.example', 'https://a.example/ x', '', 'not a url', 'https://', 'java\tscript:alert(1)', 'https://a.example/\u0000'])('rejects %j', (raw) => {
    expect(normalizeLinkUrl(raw).ok).toBe(false)
  })

  it('safeHref refuses anything not stored as http(s)', () => {
    expect(safeHref('https://a.example/p')).toBe('https://a.example/p')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('a.example')).toBeNull()
    expect(hostLabel('https://www.canva.com/x')).toBe('canva.com')
  })

  it('filters (search, category, pinned first)', () => {
    const link = (p: Partial<WorkspaceLink> & { id: string }): WorkspaceLink => ({ title: p.id, url: 'https://a.example/', description: '', category: null, pinned: false, openCount: 0, lastOpenedAt: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...p })
    const links = [link({ id: 'a', lastOpenedAt: '2026-11-03T00:00:00Z' }), link({ id: 'b', pinned: true }), link({ id: 'c', category: 'งานธุรการ', description: 'สพม' })]
    expect(filterLinks(links, DEFAULT_LINK_FILTERS).map((l) => l.id)).toEqual(['b', 'a', 'c'])
    expect(filterLinks(links, { ...DEFAULT_LINK_FILTERS, query: 'สพม' }).map((l) => l.id)).toEqual(['c'])
    expect(filterLinks(links, { ...DEFAULT_LINK_FILTERS, category: 'งานธุรการ' }).map((l) => l.id)).toEqual(['c'])
    expect(filterLinks(links, { ...DEFAULT_LINK_FILTERS, pinnedOnly: true }).map((l) => l.id)).toEqual(['b'])
  })
})

describe('notes model', () => {
  const note = (p: Partial<WorkspaceNote> & { id: string }): WorkspaceNote => ({ title: '', body: '', category: null, tags: [], pinned: false, archivedAt: null, revision: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...p })

  it('title falls back to the first line; excerpt skips it', () => {
    expect(noteDisplayTitle(note({ id: 'a', body: '\n  สรุปประชุม\nบรรทัดสอง' }))).toBe('สรุปประชุม')
    expect(noteDisplayTitle(note({ id: 'a' }))).toBe('บันทึกไม่มีชื่อ')
    expect(noteExcerpt(note({ id: 'a', body: 'หัว\nเนื้อหา' }))).toBe('เนื้อหา')
  })

  it('pinned first, archived only in the archive view, search covers tags', () => {
    const notes = [note({ id: 'a', updatedAt: '2026-11-03T00:00:00Z' }), note({ id: 'b', pinned: true }), note({ id: 'c', archivedAt: '2026-11-02T00:00:00Z', tags: ['ม.2'] })]
    expect(filterNotes(notes, DEFAULT_NOTE_FILTERS).map((n) => n.id)).toEqual(['b', 'a'])
    expect(filterNotes(notes, { ...DEFAULT_NOTE_FILTERS, view: 'archived' }).map((n) => n.id)).toEqual(['c'])
    expect(filterNotes(notes, { ...DEFAULT_NOTE_FILTERS, view: 'archived', query: 'ม.2' }).map((n) => n.id)).toEqual(['c'])
    expect(recentNotes(notes, 1).map((n) => n.id)).toEqual(['b'])
  })

  it('tags and links in a note', () => {
    expect(parseTags('ม.2, #กิจกรรม,, ม.2')).toEqual(['ม.2', 'กิจกรรม'])
    expect(extractLinks('ดู https://a.example/x). และ javascript:alert(1) กับ https://a.example/x')).toEqual(['https://a.example/x'])
  })
})

describe('tasks model — one task list behind every view', () => {
  const tasks = [
    task({ id: 'overdue', dueDate: '2026-11-01', priority: 'high', important: true, urgent: true }),
    task({ id: 'today', dueDate: T, priority: 'high', important: true }),
    task({ id: 'soon', dueDate: '2026-11-06', urgent: true }),
    task({ id: 'later', dueDate: '2026-11-20', status: 'in_progress' }),
    task({ id: 'nodate' }),
    task({ id: 'done-today', status: 'done', dueDate: T, completedAt: '2026-11-03T03:00:00Z', priority: 'high' }),
    task({ id: 'done-old', status: 'done', completedAt: '2026-10-01T03:00:00Z' }),
  ]

  it('summary cards count real tasks', () => {
    expect(summarizeTasks(tasks, T)).toEqual({ pending: 5, highPriority: 2, dueSoon: 2, dueToday: 1, overdue: 1, done: 2 })
  })

  it('due state', () => {
    expect(['overdue', 'today', 'soon', 'later', 'nodate', 'done-today'].map((id) => dueState(tasks.find((t) => t.id === id)!, T))).toEqual(['overdue', 'today', 'soon', 'later', 'none', 'done'])
  })

  it("today's list: overdue + today open, then finished today", () => {
    expect(todayTasks(tasks, T).map((t) => t.id)).toEqual(['overdue', 'today', 'done-today'])
    expect(upcomingTasks(tasks, T).map((t) => t.id)).toEqual(['soon'])
    expect(upcomingTasks(tasks, T, 30).map((t) => t.id)).toEqual(['soon', 'later'])
  })

  it('matrix quadrant comes from important/urgent only (not priority)', () => {
    expect(quadrantOf({ important: true, urgent: true })).toBe('do')
    expect(quadrantOf({ important: true, urgent: false })).toBe('plan')
    expect(quadrantOf({ important: false, urgent: true })).toBe('delegate')
    expect(quadrantOf({ important: false, urgent: false })).toBe('later')
    expect(quadrantFlags('delegate')).toEqual({ important: false, urgent: true })
    const g = groupByQuadrant(tasks)
    expect(g.do.map((t) => t.id)).toEqual(['overdue'])
    expect(g.plan.map((t) => t.id)).toEqual(['today'])
    expect(g.later.map((t) => t.id)).toEqual(['later', 'nodate']) // done tasks are left out
  })

  it('filters by status, priority, due and date, and searches', () => {
    expect(filterTasks(tasks, DEFAULT_TASK_FILTERS, T).map((t) => t.id)).toEqual(['overdue', 'today', 'soon', 'later', 'nodate'])
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, status: 'done' }, T)).toHaveLength(2)
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, status: 'all', due: 'today' }, T).map((t) => t.id)).toEqual(['today', 'done-today'])
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, due: 'overdue' }, T).map((t) => t.id)).toEqual(['overdue'])
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, due: 'date', date: '2026-11-20' }, T).map((t) => t.id)).toEqual(['later'])
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, priority: 'high' }, T).map((t) => t.id)).toEqual(['overdue', 'today'])
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, query: 'NODATE' }, T).map((t) => t.id)).toEqual(['nodate'])
  })

  it('calendar groups by the stored due day', () => {
    const map = tasksByDate(tasks)
    expect(map.get(T)?.map((t) => t.id)).toEqual(['today', 'done-today'])
    expect(map.has('2026-11-02')).toBe(false)
  })

  it('kanban: move between columns and reorder', () => {
    const board = [task({ id: 'a', sortOrder: 0 }), task({ id: 'b', sortOrder: 1024 }), task({ id: 'c', sortOrder: 2048 }), task({ id: 'x', status: 'in_progress', sortOrder: 0 })]
    expect(planMove(board, 'c', 'todo', 0)).toEqual([{ id: 'c', patch: { sortOrder: -1024 } }])
    expect(planMove(board, 'a', 'todo', 2)).toEqual([{ id: 'a', patch: { sortOrder: 3072 } }])
    expect(planMove(board, 'b', 'in_progress', 1)).toEqual([{ id: 'b', patch: { sortOrder: 1024, status: 'in_progress' } }])
    expect(planMove(board, 'x', 'todo', 1)).toEqual([{ id: 'x', patch: { sortOrder: 512, status: 'todo' } }])
    expect(planMove(board, 'b', 'todo', 1)).toEqual([]) // already there
    // Neighbours too close: the column is renumbered.
    const tight = [task({ id: 'a', sortOrder: 0 }), task({ id: 'b', sortOrder: 1e-9 }), task({ id: 'm', status: 'done' })]
    const plan = planMove(tight, 'm', 'todo', 1)
    const next = tight.map((t) => ({ ...t, ...plan.find((p) => p.id === t.id)?.patch }))
    expect(columnTasks(next, 'todo').map((t) => t.id)).toEqual(['a', 'm', 'b'])
  })

  it('a status change elsewhere puts the card on top of its new column', () => {
    const board = [task({ id: 'a', status: 'done', sortOrder: 5 }), task({ id: 'b' })]
    expect(statusChangePatch(board, board[1], 'done')).toEqual({ status: 'done', sortOrder: 5 - 1024 })
    expect(statusChangePatch(board, board[1], 'todo')).toEqual({})
  })

  it('validation mirrors the database checks', () => {
    expect(validateTaskFields({ title: '  ', startDate: null, dueDate: null })).toMatch('ชื่องาน')
    expect(validateTaskFields({ title: 'x', startDate: '2026-11-10', dueDate: '2026-11-09' })).toMatch('วันเริ่ม')
    expect(validateTaskFields({ title: 'x', startDate: T, dueDate: T })).toBeNull()
    expect(categoryOptions(['การสอน', 'ประชุม'], ['ส่วนตัว', null, 'การสอน', ' '])).toEqual(['การสอน', 'ประชุม', 'ส่วนตัว'])
  })
})
