import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildManifestTable, sortReadableRoster, type ReadableRosterItem } from '@/services/backup-service'

function rosterItem(overrides: Partial<ReadableRosterItem> = {}): ReadableRosterItem {
  return {
    classroomName: 'ม.5/1',
    number: 1,
    studentCode: 'S001',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    statusLabel: 'กำลังเรียน',
    ...overrides,
  }
}

describe('buildManifestTable — pure backup manifest', () => {
  it('includes generated_at, teacher_email, schema version, and every row count given', () => {
    const table = buildManifestTable('2026-09-10T12:00:00.000Z', 'teacher@example.com', {
      classrooms: 3,
      students: 42,
    })
    expect(table.rows).toContainEqual(['generated_at', '2026-09-10T12:00:00.000Z'])
    expect(table.rows).toContainEqual(['teacher_email', 'teacher@example.com'])
    expect(table.rows).toContainEqual(['rows_classrooms', 3])
    expect(table.rows).toContainEqual(['rows_students', 42])
    expect(table.rows.some((r) => r[0] === 'backup_schema_version')).toBe(true)
    expect(table.rows.some((r) => r[0] === 'latest_accounted_migration')).toBe(true)
  })

  it('writes an empty string (never null/undefined) when the teacher has no email on file', () => {
    const table = buildManifestTable('2026-09-10T12:00:00.000Z', null, {})
    expect(table.rows).toContainEqual(['teacher_email', ''])
  })
})

describe('sortReadableRoster — required readable/student_roster.csv ordering', () => {
  it('sorts by classroom name first', () => {
    const items = [rosterItem({ classroomName: 'ม.5/2', number: 1 }), rosterItem({ classroomName: 'ม.5/1', number: 1 })]
    expect(sortReadableRoster(items).map((r) => r.classroomName)).toEqual(['ม.5/1', 'ม.5/2'])
  })

  it('within the same classroom, sorts by student number/order ascending', () => {
    const items = [rosterItem({ number: 3 }), rosterItem({ number: 1 }), rosterItem({ number: 2 })]
    expect(sortReadableRoster(items).map((r) => r.number)).toEqual([1, 2, 3])
  })

  it('a student with no number sorts after every numbered student in the same classroom, never throws', () => {
    const items = [rosterItem({ number: null, firstName: 'ไม่มีเลขที่' }), rosterItem({ number: 5 })]
    expect(sortReadableRoster(items).map((r) => r.number)).toEqual([5, null])
  })

  it('does not mutate the input array (pure)', () => {
    const items = [rosterItem({ classroomName: 'ม.5/2' }), rosterItem({ classroomName: 'ม.5/1' })]
    const original = [...items]
    sortReadableRoster(items)
    expect(items).toEqual(original)
  })
})

describe('backup-service.ts — raw/readable ZIP layout and join safety (readable-export phase)', () => {
  const source = readFileSync(new URL('./backup-service.ts', import.meta.url), 'utf-8')

  it('keeps every original technical table under raw/, byte-shape unchanged', () => {
    for (const table of [
      'classrooms',
      'students',
      'classroom_memberships',
      'subjects',
      'subject_classroom_links',
      'assignments',
      'assignment_submissions',
      'assignment_resources',
      'submission_resources',
      'attendance_sessions',
      'attendance_records',
      'lessons',
      'lesson_resources',
    ]) {
      expect(source).toContain(`csvFile('raw/${table}'`)
    }
  })

  it('adds exactly the four required readable/*.csv files', () => {
    for (const table of ['student_roster', 'grades', 'attendance', 'assignments']) {
      expect(source).toContain(`csvFile('readable/${table}'`)
    }
  })

  it('never adds a name/label column to the raw assignment_submissions row — only readable/grades.csv joins in student/subject/assignment names', () => {
    const rawSubmissionPush = source.slice(
      source.indexOf('submissionRows.push(['),
      source.indexOf(']', source.indexOf('submissionRows.push([')) + 1,
    )
    expect(rawSubmissionPush).not.toMatch(/firstName|lastName|studentCode|subject\.name|a\.title/)
  })

  it('readable/grades.csv is built by joining the already-fetched roster map (studentsById) — no second Supabase fetch for names', () => {
    const gradeJoinScope = source.slice(
      source.indexOf('submissionRows.push(['),
      source.indexOf('if (submission.id)', source.indexOf('submissionRows.push([')),
    )
    expect(gradeJoinScope).toContain('studentsById.get(studentId)')
    expect(gradeJoinScope).toContain('readableGradeRows.push([')
  })

  it('readable/attendance.csv resolves subject names and student names purely from data already fetched in the same classroom iteration (no per-row Supabase call)', () => {
    const attendanceJoinScope = source.slice(
      source.indexOf('for (const record of attendance.records)'),
      source.indexOf('}),\n  )', source.indexOf('for (const record of attendance.records)')),
    )
    expect(attendanceJoinScope).toContain('subjectNameById.get(session.subjectId)')
    expect(attendanceJoinScope).toContain('studentsInClassroomById.get(record.studentId)')
    expect(attendanceJoinScope).toContain('readableAttendanceRows.push([')
  })

  it('sorts the readable roster via the exported pure sortReadableRoster before writing rows — the ordering rule is not re-implemented inline at the call site', () => {
    expect(source).toContain('sortReadableRoster(readableRosterItems)')
  })
})

describe('backup-service.ts — source-level safety guards', () => {
  const source = readFileSync(new URL('./backup-service.ts', import.meta.url), 'utf-8')

  it('never imports a signed-URL function — a signed URL is a short-lived credential, never a valid backup identifier', () => {
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line).not.toMatch(/getResourceSignedUrl|getLessonResourceSignedUrl|getSubmissionResourceSignedUrl/)
    }
  })

  it('builds every CSV through the shared buildCsvContent helper — formula-injection escaping and the UTF-8 BOM are inherited, never reimplemented', () => {
    expect(source).toContain("buildCsvContent, type ExportTable } from '@/lib/export/export-table'")
    expect(source).toMatch(/function csvFile[\s\S]*?buildCsvContent\(table\)/)
  })

  it('requires the caller\'s own authenticated identity before reading anything — cross-teacher isolation starts here', () => {
    expect(source).toContain('supabase.auth.getUser()')
    expect(source).toMatch(/async function buildTeacherBackup[\s\S]*?requireTeacherIdentity\(\)/)
  })

  it('never applies an active/archived filter before mapping classrooms, subjects, assignments, or lessons into rows — archived academic history must stay in the export', () => {
    expect(source).not.toContain('.filter(')
  })

  it('reuses only existing, already-RLS-scoped service functions — no raw supabase.from(...) query of its own (getSupabaseClient is used only for auth.getUser())', () => {
    expect(source).not.toMatch(/supabase\s*\.\s*from\(/)
  })
})
