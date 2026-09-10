import { describe, expect, it } from 'vitest'

import { buildClassroomAttendanceExportTable, buildClassroomGradesExportTable } from '@/features/subjects-real/classroom-export-builders'
import type { AttendanceRecordWithSession } from '@/services/attendance-service'
import type { Assignment } from '@/types/assignment'
import type { AttendanceSession } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'

function student(overrides: Partial<ClassroomStudent> = {}): ClassroomStudent {
  return {
    id: 's1',
    classroomStudentId: 'cs1',
    studentCode: '67001',
    number: 1,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    nickname: null,
    email: null,
    phone: null,
    status: 'active',
    joinedAt: '2026-05-01T00:00:00Z',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    subjectId: 'subj-1',
    classroomId: 'room-1',
    topicId: null,
    title: 'ใบงานที่ 1',
    description: null,
    maxScore: 10,
    dueDate: null,
    isArchived: false,
    createdBy: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildClassroomGradesExportTable (Google Sheets Integration, Section 2)', () => {
  it('produces the exact required column order: classroom, student_number, student_code, student_name, assignment title, score, max_score, percentage', () => {
    const table = buildClassroomGradesExportTable(
      'คณิตศาสตร์',
      'ม.5/1',
      [assignment()],
      [student()],
      { a1: { s1: { studentId: 's1', status: 'submitted', score: 8, note: null } } },
    )

    expect(table.headers).toEqual(['ห้องเรียน', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ชื่องาน', 'คะแนนที่ได้', 'คะแนนเต็ม', 'เปอร์เซ็นต์'])
    expect(table.rows).toEqual([['ม.5/1', 1, '67001', 'สมชาย ใจดี', 'ใบงานที่ 1', 8, 10, '80.0%']])
  })

  it('renders an ungraded submission as "-" for both score and percentage, never 0', () => {
    const table = buildClassroomGradesExportTable('คณิตศาสตร์', 'ม.5/1', [assignment()], [student()], {})
    expect(table.rows[0][5]).toBe('-')
    expect(table.rows[0][7]).toBe('-')
  })

  it('emits one row per (student, assignment) pair — a long/tidy table, never a wide matrix', () => {
    const students = [student({ id: 's1' }), student({ id: 's2', studentCode: '67002', firstName: 'สมหญิง' })]
    const assignments = [assignment({ id: 'a1' }), assignment({ id: 'a2', title: 'ใบงานที่ 2' })]
    const table = buildClassroomGradesExportTable('คณิตศาสตร์', 'ม.5/1', assignments, students, {})
    expect(table.rows).toHaveLength(4)
  })
})

describe('buildClassroomAttendanceExportTable (Google Sheets Integration, Section 3)', () => {
  const session: AttendanceSession = {
    id: 'sess-1',
    classroomId: 'room-1',
    subjectId: 'subj-1',
    periodNumber: null,
    attendanceDate: '2026-09-01',
    createdBy: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }

  it('produces the exact required column order: date, classroom, subject, student_number, student_code, student_name, status, note', () => {
    const record: AttendanceRecordWithSession = { sessionId: 'sess-1', studentId: 's1', status: 'late', note: 'มาสาย 10 นาที' }
    const table = buildClassroomAttendanceExportTable('คณิตศาสตร์', 'ม.5/1', [session], [record], [student()])

    expect(table.headers).toEqual(['วันที่', 'ห้องเรียน', 'วิชา', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'สถานะ', 'หมายเหตุ'])
    expect(table.rows).toEqual([['2026-09-01', 'ม.5/1', 'คณิตศาสตร์', 1, '67001', 'สมชาย ใจดี', 'สาย', 'มาสาย 10 นาที']])
  })

  it('renders a null note as an empty string, never the literal "null"', () => {
    const record: AttendanceRecordWithSession = { sessionId: 'sess-1', studentId: 's1', status: 'present', note: null }
    const table = buildClassroomAttendanceExportTable('คณิตศาสตร์', 'ม.5/1', [session], [record], [student()])
    expect(table.rows[0][7]).toBe('')
  })

  it('sorts rows by date', () => {
    const laterSession: AttendanceSession = { ...session, id: 'sess-2', attendanceDate: '2026-09-05' }
    const records: AttendanceRecordWithSession[] = [
      { sessionId: 'sess-2', studentId: 's1', status: 'present', note: null },
      { sessionId: 'sess-1', studentId: 's1', status: 'present', note: null },
    ]
    const table = buildClassroomAttendanceExportTable('คณิตศาสตร์', 'ม.5/1', [session, laterSession], records, [student()])
    expect(table.rows.map((r) => r[0])).toEqual(['2026-09-01', '2026-09-05'])
  })
})
