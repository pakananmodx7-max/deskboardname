import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ==================================================
// "ลบรายวิชาและข้อมูลทั้งหมด" (permanent subject delete) — source-text
// guards, same pattern as this codebase's other network-calling
// authorization/wiring assertions (see assignment-service.test.ts's
// deleteAssignmentPermanently tests).
// ==================================================

function readSource(): string {
  return readFileSync(new URL('./subject-service.ts', import.meta.url), 'utf-8')
}

describe('subject-service.ts — no circular import with assignment-service.ts', () => {
  const source = readSource()

  it('never imports from assignment-service.ts — assignment-service.ts already imports FROM this file (getSubjects/getSubjectClassrooms for the copy feature), so the reverse import would form a cycle', () => {
    expect(source).not.toContain("from '@/services/assignment-service'")
  })

  it('instead imports the lower-level assignment-resource-service.ts / submission-service.ts helpers directly, which do not import this file', () => {
    expect(source).toContain("from '@/services/assignment-resource-service'")
    expect(source).toContain("from '@/services/submission-service'")
  })
})

describe('hasAnySubjectAttendance — the exact signal deleteSubjectPermanently pre-checks', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('export async function hasAnySubjectAttendance'),
    source.indexOf('\n}\n', source.indexOf('export async function hasAnySubjectAttendance')),
  )

  it('counts attendance_sessions rows for this subject, never fetches full rows just to check existence', () => {
    expect(fnBody).toContain("from('attendance_sessions')")
    expect(fnBody).toContain("{ count: 'exact', head: true }")
    expect(fnBody).toContain("eq('subject_id', subjectId)")
  })
})

describe('deleteSubjectPermanently — attendance is checked FIRST, before any Storage object is touched', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('export async function deleteSubjectPermanently'),
    source.indexOf('\n}\n', source.indexOf('export async function deleteSubjectPermanently')),
  )

  it('calls hasAnySubjectAttendance as the very first thing, before fetching any lessons/assignments/resources', () => {
    const attendanceCheckIndex = fnBody.indexOf('await hasAnySubjectAttendance(subjectId)')
    const lessonsFetchIndex = fnBody.indexOf('getLessonsForSubject(subjectId)')
    const assignmentsFetchIndex = fnBody.indexOf("from('assignments')")
    expect(attendanceCheckIndex).toBeGreaterThan(-1)
    expect(attendanceCheckIndex).toBeLessThan(lessonsFetchIndex)
    expect(attendanceCheckIndex).toBeLessThan(assignmentsFetchIndex)
  })

  it('throws immediately (never proceeds to cleanup) when attendance exists — a clear Thai message naming attendance', () => {
    const guardClause = fnBody.slice(0, fnBody.indexOf('const supabase = getSupabaseClient()'))
    expect(guardClause).toContain('if (hasAttendance) {')
    expect(guardClause).toContain('throw new Error(')
    expect(guardClause).toMatch(/เช็คชื่อ|การเข้าเรียน/)
  })

  it('cleans up lesson resources for EVERY lesson under this subject (across every linked classroom), before assignments', () => {
    const lessonsIndex = fnBody.indexOf('getLessonsForSubject(subjectId)')
    const lessonCleanupIndex = fnBody.indexOf('removeLessonResourceStorageObjects(resources)')
    const assignmentsQueryIndex = fnBody.indexOf("from('assignments')")
    expect(lessonsIndex).toBeGreaterThan(-1)
    expect(lessonCleanupIndex).toBeGreaterThan(lessonsIndex)
    expect(lessonCleanupIndex).toBeLessThan(assignmentsQueryIndex)
  })

  it('cleans up BOTH assignment-files and submission-files Storage for every assignment under this subject', () => {
    expect(fnBody).toContain('removeResourceStorageObjects(resources)')
    expect(fnBody).toContain('removeSubmissionResourceStorageObjects(submissionStoragePaths)')
    expect(fnBody).toContain('getSubmissionResourceStoragePathsForAssignment(assignmentId)')
  })

  it('every assignment/resource query is scoped by subject_id — never an unscoped table read', () => {
    expect(fnBody).toContain("eq('subject_id', subjectId)")
  })

  it('all Storage cleanup happens BEFORE the subjects row delete, never after', () => {
    const lastCleanupIndex = fnBody.lastIndexOf('removeSubmissionResourceStorageObjects(submissionStoragePaths)')
    const deleteIndex = fnBody.indexOf(".from('subjects').delete().eq('id', subjectId)")
    expect(lastCleanupIndex).toBeGreaterThan(-1)
    expect(lastCleanupIndex).toBeLessThan(deleteIndex)
  })

  it('reads back the deleted row via .select(\'id\') to tell "genuinely deleted" apart from "RLS silently denied it"', () => {
    expect(fnBody).toContain(".from('subjects').delete().eq('id', subjectId).select('id')")
    expect(fnBody).toContain('data.length === 0')
  })

  it('catches a foreign-key-violation (23503, e.g. a race where attendance was recorded after the pre-check) with the same clear Thai message, as defense-in-depth only', () => {
    expect(fnBody).toContain("error.code === '23503'")
  })

  it('never deletes classrooms, students, or another subject\'s rows — no delete/remove call targets those tables', () => {
    expect(fnBody).not.toMatch(/\.from\('classrooms'\)[\s\S]{0,60}\.delete\(/)
    expect(fnBody).not.toMatch(/\.from\('students'\)[\s\S]{0,60}\.delete\(/)
  })

  it('never references Google/Drive anywhere — deleting a subject never touches any teacher\'s original Drive file', () => {
    expect(fnBody).not.toMatch(/google|drive/i)
  })
})
