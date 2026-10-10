import { describe, expect, it } from 'vitest'

import type { AttendanceRecord } from '@/types/attendance'

import {
  BOARD_STATUS_LABEL,
  changedStudentIds,
  countUnchecked,
  decodeRecord,
  decodeRecords,
  encodeEntry,
  filterBoardStudents,
  markAllPresent,
  markUncheckedAbsent,
  mergeLoadedEntries,
  nextBoardStatus,
  recordsToSave,
  SICK_NOTE_PREFIX,
  studentInitials,
  summarizeBoard,
  withNote,
  withStatus,
  type BoardEntries,
} from './attendance-board-model'

describe('click cycle', () => {
  it('มาเรียน → มาสาย → ขาดเรียน → ลากิจ → ลาป่วย → มาเรียน', () => {
    const seen = ['present']
    for (let i = 0; i < 5; i++) seen.push(nextBoardStatus(seen[seen.length - 1] as never))
    expect(seen).toEqual(['present', 'late', 'absent', 'leave', 'sick', 'present'])
  })

  it('an unchecked student becomes มาเรียน on the first click; nothing cycles back to unchecked', () => {
    expect(nextBoardStatus('unchecked')).toBe('present')
    for (const s of ['present', 'late', 'absent', 'leave', 'sick'] as const) expect(nextBoardStatus(s)).not.toBe('unchecked')
  })

  it('Thai labels', () => {
    expect(BOARD_STATUS_LABEL).toMatchObject({ present: 'มาเรียน', late: 'มาสาย', absent: 'ขาดเรียน', leave: 'ลากิจ', sick: 'ลาป่วย', unchecked: 'ยังไม่เช็ค' })
  })
})

describe('database compatibility (statuses present/late/leave/absent only)', () => {
  it('no record = unchecked', () => {
    expect(decodeRecord(undefined)).toEqual({ status: 'unchecked', note: '' })
  })

  it('historical leave rows stay ลากิจ; their notes are kept', () => {
    expect(decodeRecord({ studentId: 'a', status: 'leave', note: 'งานบวช' })).toEqual({ status: 'leave', note: 'งานบวช' })
    expect(decodeRecord({ studentId: 'a', status: 'absent', note: null })).toEqual({ status: 'absent', note: '' })
  })

  it('ลาป่วย is saved as status leave with a readable note prefix and round-trips', () => {
    const withNoteText = encodeEntry('a', { status: 'sick', note: 'มีไข้' })
    expect(withNoteText).toEqual({ studentId: 'a', status: 'leave', note: `${SICK_NOTE_PREFIX} มีไข้` })
    expect(decodeRecord(withNoteText)).toEqual({ status: 'sick', note: 'มีไข้' })
    const bare = encodeEntry('a', { status: 'sick', note: '' })
    expect(bare).toEqual({ studentId: 'a', status: 'leave', note: SICK_NOTE_PREFIX })
    expect(decodeRecord(bare)).toEqual({ status: 'sick', note: '' })
  })

  it('every encoded status is one the database accepts; unchecked is never encoded', () => {
    for (const status of ['present', 'late', 'absent', 'leave', 'sick'] as const) {
      expect(['present', 'late', 'leave', 'absent']).toContain(encodeEntry('a', { status, note: '' })!.status)
    }
    expect(encodeEntry('a', { status: 'unchecked', note: 'x' })).toBeNull()
  })

  it('a non-sick status never keeps the sick marker; empty notes are saved as null', () => {
    expect(encodeEntry('a', { status: 'leave', note: `${SICK_NOTE_PREFIX} ป่วย` })).toEqual({ studentId: 'a', status: 'leave', note: 'ป่วย' })
    expect(encodeEntry('a', { status: 'present', note: '   ' })).toEqual({ studentId: 'a', status: 'present', note: null })
  })
})

const IDS = ['a', 'b', 'c', 'd']
const SAVED: Record<string, AttendanceRecord> = {
  a: { studentId: 'a', status: 'present', note: null },
  b: { studentId: 'b', status: 'leave', note: `${SICK_NOTE_PREFIX} ไข้หวัด` },
}

describe('changes and what gets saved', () => {
  const baseline = decodeRecords(IDS, SAVED)

  it('loaded session: saved students keep their status, the rest are unchecked', () => {
    expect(baseline).toEqual({
      a: { status: 'present', note: '' },
      b: { status: 'sick', note: 'ไข้หวัด' },
      c: { status: 'unchecked', note: '' },
      d: { status: 'unchecked', note: '' },
    })
  })

  it('nothing changed → nothing to save (historical records are never re-sent)', () => {
    expect(changedStudentIds(IDS, baseline, baseline)).toEqual([])
    expect(recordsToSave(IDS, baseline, baseline)).toEqual([])
  })

  it('only changed AND checked students are saved; unchecked students are never auto-marked absent', () => {
    let entries = withStatus(baseline, 'c', 'late')
    entries = withNote(entries, 'd', 'โน้ตแต่ยังไม่เช็ค')
    expect(changedStudentIds(IDS, entries, baseline)).toEqual(['c', 'd'])
    expect(recordsToSave(IDS, entries, baseline)).toEqual([{ studentId: 'c', status: 'late', note: null }])
  })

  it('a note edit on a saved student is saved with its status', () => {
    const entries = withNote(baseline, 'a', 'มาพร้อมผู้ปกครอง')
    expect(recordsToSave(IDS, entries, baseline)).toEqual([{ studentId: 'a', status: 'present', note: 'มาพร้อมผู้ปกครอง' }])
  })

  it('changing back to the saved value is not a change', () => {
    const entries = withStatus(withStatus(baseline, 'a', 'late'), 'a', 'present')
    expect(changedStudentIds(IDS, entries, baseline)).toEqual([])
  })

  it('a late-arriving load keeps edits made meanwhile', () => {
    const current: BoardEntries = { a: { status: 'absent', note: '' } }
    expect(mergeLoadedEntries(current, baseline, new Set(['a'])).a).toEqual({ status: 'absent', note: '' })
    expect(mergeLoadedEntries(current, baseline, new Set()).a).toEqual({ status: 'present', note: '' })
  })
})

describe('bulk actions', () => {
  const baseline = decodeRecords(IDS, SAVED)

  it('มาครบทุกคน marks everyone present and keeps notes', () => {
    const next = markAllPresent(baseline, IDS)
    expect(IDS.map((id) => next[id].status)).toEqual(['present', 'present', 'present', 'present'])
    expect(next.b.note).toBe('ไข้หวัด')
  })

  it('ที่เหลือขาดเรียน only touches students still unchecked', () => {
    const next = markUncheckedAbsent(baseline, IDS)
    expect(IDS.map((id) => next[id].status)).toEqual(['present', 'sick', 'absent', 'absent'])
    expect(countUnchecked(baseline, IDS)).toBe(2)
    expect(countUnchecked(next, IDS)).toBe(0)
  })
})

describe('summary, filters, initials', () => {
  const students = [
    { id: 'a', number: 1, firstName: 'กฤษกร', lastName: 'สีราเลา', nickname: 'ทดลอง' },
    { id: 'b', number: 2, firstName: 'เกศินี', lastName: 'ใจดี', nickname: null },
    { id: 'c', number: 3, firstName: 'ชนม์', lastName: 'มั่นคง', nickname: 'บิว' },
    { id: 'd', number: 4, firstName: 'ดารา', lastName: 'แสงทอง', nickname: '' },
  ]
  const entries = decodeRecords(IDS, SAVED)

  it('summary counts every status including unchecked', () => {
    expect(summarizeBoard(entries, IDS)).toEqual({ present: 1, late: 0, absent: 0, leave: 0, sick: 1, unchecked: 2, total: 4 })
  })

  it('filters by status and searches name, nickname, number and note', () => {
    expect(filterBoardStudents(students, entries, { search: '', status: 'unchecked' }).map((s) => s.id)).toEqual(['c', 'd'])
    expect(filterBoardStudents(students, entries, { search: 'บิว', status: 'all' }).map((s) => s.id)).toEqual(['c'])
    expect(filterBoardStudents(students, entries, { search: '4', status: 'all' }).map((s) => s.id)).toEqual(['d'])
    expect(filterBoardStudents(students, entries, { search: 'ไข้', status: 'all' }).map((s) => s.id)).toEqual(['b'])
  })

  it('initials skip a leading Thai vowel', () => {
    expect(studentInitials('กฤษกร', 'สีราเลา')).toBe('กส')
    expect(studentInitials('เกศินี', 'ใจดี')).toBe('กจ')
    expect(studentInitials('', '')).toBe('?')
  })
})
