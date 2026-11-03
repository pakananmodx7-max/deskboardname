import { safeHref } from './workspace-links-model'
import type { WorkspaceNote } from './workspace-types'

export const DEFAULT_NOTE_CATEGORIES = ['การสอน', 'ประชุม', 'ไอเดีย', 'งานธุรการ', 'ส่วนตัว']

export const MAX_NOTE_TITLE = 200
export const MAX_NOTE_BODY = 100_000
export const MAX_TAGS = 20
const MAX_TAG_LENGTH = 30

export type NoteView = 'active' | 'archived'
export type NoteSort = 'updated' | 'oldest' | 'title'

export const NOTE_SORTS: { key: NoteSort; label: string }[] = [
  { key: 'updated', label: 'แก้ไขล่าสุด' },
  { key: 'oldest', label: 'เก่าที่สุด' },
  { key: 'title', label: 'ชื่อ (ก-ฮ)' },
]

export interface NoteFilters {
  query: string
  view: NoteView
  category: 'all' | string
  sort: NoteSort
}

export const DEFAULT_NOTE_FILTERS: NoteFilters = { query: '', view: 'active', category: 'all', sort: 'updated' }

/** The title, or the body's first line, or a placeholder. */
export function noteDisplayTitle(note: Pick<WorkspaceNote, 'title' | 'body'>): string {
  const title = note.title.trim()
  if (title) return title
  const firstLine = note.body.split('\n').find((l) => l.trim())?.trim()
  return firstLine ? firstLine.slice(0, 80) : 'บันทึกไม่มีชื่อ'
}

/** A one-paragraph preview of the body (without the line used as title). */
export function noteExcerpt(note: Pick<WorkspaceNote, 'title' | 'body'>, max = 140): string {
  let body = note.body.trim()
  if (!note.title.trim()) body = body.split('\n').slice(1).join(' ').trim()
  const flat = body.replace(/\s+/g, ' ')
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function sortNotes(notes: WorkspaceNote[], sort: NoteSort): WorkspaceNote[] {
  const copy = [...notes]
  copy.sort((a, b) => {
    if (sort === 'title') return noteDisplayTitle(a).localeCompare(noteDisplayTitle(b), 'th')
    if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt)
    return b.updatedAt.localeCompare(a.updatedAt)
  })
  return copy
}

/** Pinned notes first (active view), then the chosen order. */
export function filterNotes(notes: WorkspaceNote[], filters: NoteFilters): WorkspaceNote[] {
  const q = filters.query.trim().toLocaleLowerCase('th')
  const result = notes.filter((n) => {
    if (filters.view === 'archived' ? !n.archivedAt : n.archivedAt) return false
    if (filters.category !== 'all' && (n.category ?? '') !== filters.category) return false
    if (!q) return true
    return [n.title, n.body, n.category ?? '', ...n.tags].some((v) => v.toLocaleLowerCase('th').includes(q))
  })
  const sorted = sortNotes(result, filters.sort)
  if (filters.view === 'archived') return sorted
  return [...sorted.filter((n) => n.pinned), ...sorted.filter((n) => !n.pinned)]
}

/** ภาพรวม: pinned first, then most recently edited (active only). */
export function recentNotes(notes: WorkspaceNote[], limit = 3): WorkspaceNote[] {
  return filterNotes(notes, DEFAULT_NOTE_FILTERS).slice(0, limit)
}

/** "ม.2, กิจกรรม #ไอเดีย" → ['ม.2', 'กิจกรรม', 'ไอเดีย'] (trimmed, unique, bounded). */
export function parseTags(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[,،\n]+/)) {
    const tag = raw.trim().replace(/^#+/, '').slice(0, MAX_TAG_LENGTH).trim()
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export function formatTags(tags: string[]): string {
  return tags.join(', ')
}

/** Safe http(s) links written in a note's body, in order, unique. */
export function extractLinks(body: string, limit = 10): string[] {
  const out: string[] = []
  for (const match of body.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const href = safeHref(match[0].replace(/[),.;:!?\]]+$/, ''))
    if (href && !out.includes(href)) out.push(href)
    if (out.length >= limit) break
  }
  return out
}

/** Plain text for "คัดลอกบันทึก". */
export function noteCopyText(note: Pick<WorkspaceNote, 'title' | 'body'>): string {
  const title = note.title.trim()
  return title ? `${title}\n\n${note.body}` : note.body
}

export function validateNoteFields(fields: { title?: string; body?: string; category?: string | null }): string | null {
  if ((fields.title ?? '').length > MAX_NOTE_TITLE) return `ชื่อบันทึกยาวเกิน ${MAX_NOTE_TITLE} ตัวอักษร`
  if ((fields.body ?? '').length > MAX_NOTE_BODY) return 'เนื้อหาบันทึกยาวเกินไป'
  if (fields.category && fields.category.trim().length > 60) return 'ชื่อหมวดหมู่ยาวเกิน 60 ตัวอักษร'
  return null
}
