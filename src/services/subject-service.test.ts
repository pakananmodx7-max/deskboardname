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

describe('getClassroomSubjects — reverse of getSubjectClassrooms, backs the Classroom Workspace tabs', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('export async function getClassroomSubjects'),
    source.indexOf('\n}\n', source.indexOf('export async function getClassroomSubjects')),
  )

  it('queries the same subject_classrooms join table as getSubjectClassrooms, filtered by classroom_id instead of subject_id', () => {
    expect(fnBody).toContain("from('subject_classrooms')")
    expect(fnBody).toContain("eq('classroom_id', classroomId)")
  })

  it('selects the full subject row via the join, never a separate per-subject fetch (no N+1)', () => {
    expect(fnBody).toContain("select('subjects(*)')")
  })

  it('maps rows through the same mapSubject used everywhere else, not a duplicated mapper', () => {
    expect(fnBody).toContain('mapSubject(row.subjects)')
  })

  it('surfaces query errors instead of swallowing them', () => {
    expect(fnBody).toContain('if (error) throw error')
  })
})

describe('countSubjectAttendanceSessions — the signal the subjects page uses for the stronger delete confirmation', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('export async function countSubjectAttendanceSessions'),
    source.indexOf('\n}\n', source.indexOf('export async function countSubjectAttendanceSessions')),
  )

  it('counts attendance_sessions rows for this subject, never fetches full rows just to count', () => {
    expect(fnBody).toContain("from('attendance_sessions')")
    expect(fnBody).toContain("{ count: 'exact', head: true }")
    expect(fnBody).toContain("eq('subject_id', subjectId)")
  })

  it('the old "refuse when attendance exists" guard is gone — attendance no longer blocks subject deletion', () => {
    expect(source).not.toContain('hasAnySubjectAttendance')
    expect(source).not.toContain("error.code === '23503'")
  })
})

describe('deleteSubjectPermanently — attendance is deleted WITH the subject through 0022\'s ownership-checked RPC', () => {
  const source = readSource()
  const fnBody = source.slice(
    source.indexOf('export async function deleteSubjectPermanently'),
    source.indexOf('\n}\n', source.indexOf('export async function deleteSubjectPermanently')),
  )

  it('does the actual delete through the delete_subject_permanently RPC (attendance + subject in ONE transaction), never a raw client-side delete of attendance or subjects', () => {
    expect(fnBody).toContain("supabase.rpc('delete_subject_permanently', { p_subject_id: subjectId })")
    expect(fnBody).not.toMatch(/\.from\('attendance_sessions'\)[\s\S]{0,80}\.delete\(/)
    expect(fnBody).not.toMatch(/\.from\('attendance_records'\)[\s\S]{0,80}\.delete\(/)
    expect(fnBody).not.toMatch(/\.from\('subjects'\)[\s\S]{0,80}\.delete\(/)
  })

  it('refuses (RLS-checked ownership read) BEFORE touching any Storage object when the caller does not own the subject', () => {
    const ownershipReadIndex = fnBody.indexOf(".from('subjects')")
    const ownershipGuardIndex = fnBody.indexOf('if (!owned) {')
    const lessonsFetchIndex = fnBody.indexOf('getLessonsForSubject(subjectId)')
    const assignmentsFetchIndex = fnBody.indexOf("from('assignments')")
    expect(ownershipReadIndex).toBeGreaterThan(-1)
    expect(ownershipGuardIndex).toBeGreaterThan(ownershipReadIndex)
    expect(ownershipGuardIndex).toBeLessThan(lessonsFetchIndex)
    expect(ownershipGuardIndex).toBeLessThan(assignmentsFetchIndex)
    expect(fnBody.slice(ownershipGuardIndex, lessonsFetchIndex)).toContain('throw new Error(')
  })

  it('cleans up lesson resources for EVERY lesson under this subject (across every linked classroom), before assignments', () => {
    const lessonsIndex = fnBody.indexOf('getLessonsForSubject(subjectId)')
    const lessonCleanupIndex = fnBody.indexOf('removeLessonResourceStorageObjects(resources)')
    const assignmentsQueryIndex = fnBody.indexOf("from('assignments')")
    expect(lessonsIndex).toBeGreaterThan(-1)
    expect(lessonCleanupIndex).toBeGreaterThan(lessonsIndex)
    expect(lessonCleanupIndex).toBeLessThan(assignmentsQueryIndex)
  })

  it('still cleans up BOTH assignment-files and submission-files Storage for every assignment under this subject (existing lesson/assignment/submission cleanup unchanged)', () => {
    expect(fnBody).toContain('removeResourceStorageObjects(resources)')
    expect(fnBody).toContain('removeSubmissionResourceStorageObjects(submissionStoragePaths)')
    expect(fnBody).toContain('getSubmissionResourceStoragePathsForAssignment(assignmentId)')
  })

  it('every assignment/resource query is scoped by subject_id — never an unscoped table read', () => {
    expect(fnBody).toContain("eq('subject_id', subjectId)")
  })

  it('all Storage cleanup happens BEFORE the RPC (which cascades the assignment_submissions rows submission-files\' delete policy depends on), never after', () => {
    const lastCleanupIndex = fnBody.lastIndexOf('removeSubmissionResourceStorageObjects(submissionStoragePaths)')
    const rpcIndex = fnBody.indexOf("rpc('delete_subject_permanently'")
    expect(lastCleanupIndex).toBeGreaterThan(-1)
    expect(lastCleanupIndex).toBeLessThan(rpcIndex)
  })

  it('surfaces the RPC error (42501 for a non-owner) instead of swallowing it', () => {
    const afterRpc = fnBody.slice(fnBody.indexOf("rpc('delete_subject_permanently'"))
    expect(afterRpc).toContain('if (error) throw error')
  })

  it('never deletes classrooms, students, or another subject\'s rows — no delete/remove call targets those tables', () => {
    expect(fnBody).not.toMatch(/\.from\('classrooms'\)[\s\S]{0,60}\.delete\(/)
    expect(fnBody).not.toMatch(/\.from\('students'\)[\s\S]{0,60}\.delete\(/)
  })

  it('never references Google/Drive anywhere — deleting a subject never touches any teacher\'s original Drive file', () => {
    expect(fnBody).not.toMatch(/google|drive/i)
  })
})

// ==================================================
// 0022_subject_delete_with_attendance.sql — the RPC the service above
// calls. Source-text guards on the migration itself, so the database-side
// safety properties are pinned down alongside the client ones.
// ==================================================

describe('0022_subject_delete_with_attendance.sql — delete_subject_permanently RPC', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/0022_subject_delete_with_attendance.sql', import.meta.url),
    'utf-8',
  )
  const fn = migration.slice(
    migration.indexOf('create or replace function public.delete_subject_permanently'),
    migration.indexOf('$$;', migration.indexOf('create or replace function public.delete_subject_permanently')),
  )

  it('is SECURITY DEFINER with a pinned search_path (the established 0013/0015/0016/0019 helper pattern)', () => {
    expect(fn).toContain('security definer')
    expect(fn).toContain('set search_path = public, pg_temp')
  })

  it('enforces teacher ownership INSIDE the function (auth.uid() = subjects.teacher_id) and raises 42501 otherwise — the database is the authorization boundary', () => {
    expect(fn).toContain('where s.id = p_subject_id and s.teacher_id = auth.uid()')
    expect(fn).toContain("errcode = '42501'")
    expect(fn).toContain("errcode = '28000'")
  })

  it('deletes ONLY attendance_sessions whose subject_id is this subject, then the subject — in that order, in one function (one transaction)', () => {
    const attendanceDeleteIndex = fn.indexOf('delete from public.attendance_sessions\n  where subject_id = p_subject_id;')
    const subjectDeleteIndex = fn.indexOf('delete from public.subjects\n  where id = p_subject_id and teacher_id = auth.uid();')
    expect(attendanceDeleteIndex).toBeGreaterThan(-1)
    expect(subjectDeleteIndex).toBeGreaterThan(attendanceDeleteIndex)
    // ownership check happens before either delete
    expect(fn.indexOf("errcode = '42501'")).toBeLessThan(attendanceDeleteIndex)
  })

  it('never deletes students, classrooms, profiles, or attendance_records directly (records go only via the 0004 cascade of THIS subject\'s sessions)', () => {
    expect(fn).not.toMatch(/delete from public\.(students|classrooms|profiles|attendance_records|classroom_students)/)
  })

  it('does NOT change attendance_sessions.subject_id\'s ON DELETE RESTRICT and adds NO general DELETE policy on attendance tables', () => {
    expect(migration).not.toMatch(/alter table public\.attendance_(sessions|records)/)
    expect(migration).not.toMatch(/on delete cascade\s*;/)
    expect(migration).not.toMatch(/create policy[^;]*on public\.attendance_(sessions|records)/)
  })

  it('is executable by authenticated only — revoked from public and anon', () => {
    expect(migration).toContain('revoke all on function public.delete_subject_permanently(uuid) from public;')
    expect(migration).toContain('revoke all on function public.delete_subject_permanently(uuid) from anon;')
    expect(migration).toContain('grant execute on function public.delete_subject_permanently(uuid) to authenticated;')
  })

  it('does not touch the already-applied 0019/0020/0021 objects — no DROP/ALTER of any policy, table, or function; it only CREATEs its own RPC', () => {
    const statements = migration
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(statements).not.toMatch(/drop (policy|function|table|index|trigger)/i)
    expect(statements).not.toMatch(/alter (policy|table|function)/i)
    expect(statements).not.toMatch(/subjects_delete_own|lessons_delete_own|assignments_delete_own/)
  })
})
