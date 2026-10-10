import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'

/**
 * Pure model behind the subject เช็คชื่อ card board (real and demo).
 *
 * DATA MODEL (verified against 0004/0005_*.sql): attendance_records.status
 * only allows 'present' | 'late' | 'leave' | 'absent', and a student with
 * no record for a session simply has not been checked. This model adds two
 * UI-only states on top, without any migration:
 *
 *   - 'unchecked' = no record. It is never saved; save_attendance_session
 *     only upserts the records it is sent and never deletes. So leaving a
 *     student unchecked writes nothing and never touches an existing row.
 *   - 'sick' (ลาป่วย) = stored as status 'leave' with the note prefixed by
 *     SICK_NOTE_PREFIX. Every existing reader (reports, analytics, student
 *     portal, CSV export) keeps counting it as ลา, which it is. The
 *     dashboard already labels that bucket "ลา (ลากิจ/ลาป่วย)". A 'leave'
 *     row without the prefix (all historical rows) stays ลากิจ.
 */

export type BoardStatus = 'present' | 'late' | 'absent' | 'leave' | 'sick' | 'unchecked'

export interface BoardEntry {
  status: BoardStatus
  /** Teacher's note without the sick-leave marker; '' = none. */
  note: string
}

export type BoardEntries = Record<string, BoardEntry>

export const SICK_NOTE_PREFIX = '[ลาป่วย]'

export const UNCHECKED_ENTRY: BoardEntry = { status: 'unchecked', note: '' }

/** Display order (summary bar, filters, menus). */
export const BOARD_STATUS_ORDER: BoardStatus[] = ['present', 'late', 'absent', 'leave', 'sick', 'unchecked']

export const BOARD_STATUS_LABEL: Record<BoardStatus, string> = {
  present: 'มาเรียน',
  late: 'มาสาย',
  absent: 'ขาดเรียน',
  leave: 'ลากิจ',
  sick: 'ลาป่วย',
  unchecked: 'ยังไม่เช็ค',
}

/** Click cycle: มาเรียน → มาสาย → ขาดเรียน → ลากิจ → ลาป่วย → มาเรียน.
 * An unchecked student becomes มาเรียน on the first click. Nothing ever
 * cycles back to unchecked, and nothing marks a student absent on its own. */
const CYCLE: Record<BoardStatus, BoardStatus> = {
  unchecked: 'present',
  present: 'late',
  late: 'absent',
  absent: 'leave',
  leave: 'sick',
  sick: 'present',
}

export function nextBoardStatus(current: BoardStatus): BoardStatus {
  return CYCLE[current]
}

// ==================================================
// Encoding to / from attendance_records
// ==================================================

export function decodeRecord(record: AttendanceRecord | undefined | null): BoardEntry {
  if (!record) return UNCHECKED_ENTRY
  const note = record.note ?? ''
  if (record.status === 'leave' && note.startsWith(SICK_NOTE_PREFIX)) {
    return { status: 'sick', note: note.slice(SICK_NOTE_PREFIX.length).trim() }
  }
  return { status: record.status, note: stripSickPrefix(note).trim() }
}

function stripSickPrefix(note: string): string {
  return note.startsWith(SICK_NOTE_PREFIX) ? note.slice(SICK_NOTE_PREFIX.length) : note
}

/** null for 'unchecked' — such a student is never sent to the database. */
export function encodeEntry(studentId: string, entry: BoardEntry): AttendanceRecord | null {
  if (entry.status === 'unchecked') return null
  const note = stripSickPrefix(entry.note).trim()
  if (entry.status === 'sick') {
    return { studentId, status: 'leave', note: note ? `${SICK_NOTE_PREFIX} ${note}` : SICK_NOTE_PREFIX }
  }
  return { studentId, status: entry.status as AttendanceStatus, note: note || null }
}

export function decodeRecords(studentIds: string[], records: Record<string, AttendanceRecord>): BoardEntries {
  const entries: BoardEntries = {}
  for (const id of studentIds) entries[id] = decodeRecord(records[id])
  return entries
}

// ==================================================
// Changes
// ==================================================

export function entriesEqual(a: BoardEntry | undefined, b: BoardEntry | undefined): boolean {
  const x = a ?? UNCHECKED_ENTRY
  const y = b ?? UNCHECKED_ENTRY
  return x.status === y.status && x.note.trim() === y.note.trim()
}

/** Students whose on-screen entry differs from what is saved. */
export function changedStudentIds(studentIds: string[], entries: BoardEntries, baseline: BoardEntries): string[] {
  return studentIds.filter((id) => !entriesEqual(entries[id], baseline[id]))
}

/** The records to save: changed AND checked students only. Unchanged
 * rows are not re-sent, so a historical record the teacher did not touch
 * is never rewritten. */
export function recordsToSave(studentIds: string[], entries: BoardEntries, baseline: BoardEntries): AttendanceRecord[] {
  const result: AttendanceRecord[] = []
  for (const id of changedStudentIds(studentIds, entries, baseline)) {
    const record = encodeEntry(id, entries[id] ?? UNCHECKED_ENTRY)
    if (record) result.push(record)
  }
  return result
}

/** Applies a freshly loaded session while keeping edits made during the
 * load (same race guard as mergeLoadedAttendance). */
export function mergeLoadedEntries(current: BoardEntries, loaded: BoardEntries, editedIds: ReadonlySet<string>): BoardEntries {
  const merged = { ...loaded }
  for (const id of editedIds) {
    if (current[id]) merged[id] = current[id]
  }
  return merged
}

// ==================================================
// Edits
// ==================================================

export function withStatus(entries: BoardEntries, studentId: string, status: BoardStatus): BoardEntries {
  return { ...entries, [studentId]: { ...(entries[studentId] ?? UNCHECKED_ENTRY), status } }
}

export function withNote(entries: BoardEntries, studentId: string, note: string): BoardEntries {
  return { ...entries, [studentId]: { ...(entries[studentId] ?? UNCHECKED_ENTRY), note } }
}

/** มาครบทุกคน — every listed student becomes มาเรียน (notes kept). */
export function markAllPresent(entries: BoardEntries, studentIds: string[]): BoardEntries {
  const next = { ...entries }
  for (const id of studentIds) next[id] = { ...(entries[id] ?? UNCHECKED_ENTRY), status: 'present' }
  return next
}

/** ที่เหลือขาดเรียน — only students still unchecked become ขาดเรียน. */
export function markUncheckedAbsent(entries: BoardEntries, studentIds: string[]): BoardEntries {
  const next = { ...entries }
  for (const id of studentIds) {
    if ((entries[id] ?? UNCHECKED_ENTRY).status === 'unchecked') next[id] = { ...(entries[id] ?? UNCHECKED_ENTRY), status: 'absent' }
  }
  return next
}

export function countUnchecked(entries: BoardEntries, studentIds: string[]): number {
  return studentIds.filter((id) => (entries[id] ?? UNCHECKED_ENTRY).status === 'unchecked').length
}

// ==================================================
// Summary / filters / display
// ==================================================

export type BoardSummary = Record<BoardStatus, number> & { total: number }

export function summarizeBoard(entries: BoardEntries, studentIds: string[]): BoardSummary {
  const summary: BoardSummary = { present: 0, late: 0, absent: 0, leave: 0, sick: 0, unchecked: 0, total: studentIds.length }
  for (const id of studentIds) summary[(entries[id] ?? UNCHECKED_ENTRY).status] += 1
  return summary
}

export interface BoardStudent {
  id: string
  number: number | null
  firstName: string
  lastName: string
  nickname?: string | null
  studentCode?: string | null
}

export type BoardStatusFilter = BoardStatus | 'all'

export function filterBoardStudents<T extends BoardStudent>(
  students: T[],
  entries: BoardEntries,
  filters: { search: string; status: BoardStatusFilter },
): T[] {
  const query = filters.search.trim().toLowerCase()
  return students.filter((s) => {
    const entry = entries[s.id] ?? UNCHECKED_ENTRY
    if (filters.status !== 'all' && entry.status !== filters.status) return false
    if (!query) return true
    const haystack = [`${s.firstName} ${s.lastName}`, s.nickname ?? '', s.studentCode ?? '', s.number === null ? '' : String(s.number), entry.note]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
}

const THAI_LEADING_VOWELS = /^[เแโใไ]/

/** Two-letter initials ("กฤษกร สีราเลา" → "กส"), skipping a leading Thai
 * vowel so "เกศินี" gives "ก" rather than "เ". */
export function studentInitials(firstName: string, lastName: string): string {
  const first = (name: string) => {
    const trimmed = name.trim().replace(THAI_LEADING_VOWELS, '')
    return trimmed ? [...trimmed][0] : ''
  }
  return `${first(firstName)}${first(lastName)}` || '?'
}
