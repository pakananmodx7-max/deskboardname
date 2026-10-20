import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { computeAssignmentProgress, resolveSemesterScope, type AnalyticsContext } from '@/features/classroom-analytics/analytics'
import { classifyObligation } from '@/features/reports-missing/missing-report-model'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { ClassroomStudent } from '@/types/student'

import {
  computeCellDisplay,
  computeSubmissionCellState,
  computeSubmittedMissingSplit,
  filterStudentsByCheckMode,
  isMissingStatus,
  isSubmittedStatus,
  SUBMISSION_CELL_STATE_LABEL,
} from './assignment-service'
import { buildMissingAssignmentRows } from './report-service'
import { computeSubmissionTimelinessRows } from './student-analytics-service'

/**
 * 'excused' (ยกเว้น, migration 0030) is set only by a teacher. It must be
 * neither submitted nor missing anywhere the app counts work.
 */

const sub = (studentId: string, status: AssignmentSubmission['status'], score: number | null = null): AssignmentSubmission => ({ studentId, status, score, note: null })

describe('matrix (ตรวจงานและคะแนน)', () => {
  it('excused is neither submitted nor missing', () => {
    expect(isSubmittedStatus('excused')).toBe(false)
    expect(isMissingStatus('excused')).toBe(false)
    expect(isMissingStatus('not_submitted')).toBe(true)
    expect(isMissingStatus('missing')).toBe(true)
  })

  it('cells: ยกเว้น in ทั้งหมด, blank in the narrow modes', () => {
    expect(computeCellDisplay('all', 'excused', null)).toEqual({ kind: 'excused' })
    expect(computeCellDisplay('missing', 'excused', null)).toEqual({ kind: 'blank' })
    expect(computeCellDisplay('submitted', 'excused', null)).toEqual({ kind: 'blank' })
    expect(computeSubmissionCellState('excused', null)).toBe('excused')
    expect(SUBMISSION_CELL_STATE_LABEL.excused).toBe('ยกเว้น')
    // A score on an excused row is still a score — never hidden or changed.
    expect(computeSubmissionCellState('excused', 4)).toBe('graded')
  })

  it('counts and filters leave excused out of ขาดส่ง', () => {
    const byAssignment = { a1: { s1: sub('s1', 'submitted'), s2: sub('s2', 'excused') } }
    expect(computeSubmittedMissingSplit(['s1', 's2', 's3'], 'a1', byAssignment)).toEqual({ submittedCount: 1, missingCount: 1 })
    const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    expect(filterStudentsByCheckMode(students, ['a1'], byAssignment, 'missing').map((s) => s.id)).toEqual(['s3'])
  })
})

describe('reports and analytics', () => {
  it('missing-work report: excused is not an obligation', () => {
    expect(classifyObligation('excused', '2026-01-01', '2026-10-20')).toBeNull()
    expect(classifyObligation('not_submitted', '2026-01-01', '2026-10-20')).toMatchObject({ status: 'overdue' })
  })

  it('missing assignment rows skip excused students', () => {
    const assignment = { id: 'a1', subjectId: 's', classroomId: 'c', title: 'งาน', dueDate: null } as Assignment
    const roster = ['x', 'y'].map((id) => ({ id, firstName: id, lastName: '', number: 1, studentCode: null }) as unknown as ClassroomStudent)
    const rows = buildMissingAssignmentRows([assignment], { a1: { x: sub('x', 'excused') } }, new Map([['c', roster]]), new Map([['s', 'วิชา']]), new Map([['c', 'ห้อง']]))
    expect(rows.map((r) => r.studentId)).toEqual(['y'])
  })

  it('student analytics: excused leaves the totals', () => {
    const assignments = [{ id: 'a1' }, { id: 'a2' }] as Assignment[]
    const [row] = computeSubmissionTimelinessRows(['x'], assignments, { a1: { x: sub('x', 'excused') }, a2: { x: sub('x', 'submitted') } })
    expect(row).toMatchObject({ totalAssignments: 1, submittedCount: 1, missingCount: 0 })
  })

  it('dashboard progress: excused is not a slot', () => {
    const context: AnalyticsContext = {
      classrooms: [{ id: 'c1', name: 'ม.1/1', academicYear: '2569', semester: '1', isActive: true }],
      subjects: [{ id: 's1', name: 'ไทย', academicYear: '2569', semester: '1' }],
      links: [{ subjectId: 's1', classroomId: 'c1' }],
    }
    const student = (id: string) => ({ id, firstName: id, lastName: '', studentCode: null, number: null, status: 'active' as const })
    const roster = { memberships: [{ studentId: 'x', classroomId: 'c1' }, { studentId: 'y', classroomId: 'c1' }], students: [student('x'), student('y')] }
    const data = { assignments: [{ id: 'a1', classroomId: 'c1', subjectId: 's1', title: 'งาน', dueDate: '2026-01-01' }], submissions: [{ assignmentId: 'a1', studentId: 'x', status: 'excused' as const }] }
    const progress = computeAssignmentProgress(data, roster, resolveSemesterScope(context, '2569|1'), '2026-10-20')
    expect(progress).toMatchObject({ slots: 1, completed: 0, notSubmitted: 1 })
    // The insight denominator ("… จาก Y คน") leaves the excused student out too.
    expect(progress.perAssignment[0]).toMatchObject({ roster: 1, notSubmitted: 1 })
  })

  it('assignment summary card: excused is not in the total', async () => {
    const { getSubmissionSummary } = await import('./assignment-service')
    expect(getSubmissionSummary({ x: sub('x', 'excused'), y: sub('y', 'submitted') })).toMatchObject({ submitted: 1, excused: 1, total: 1 })
  })
})

describe('student portal: an excused student may still submit', () => {
  const section = readFileSync(new URL('../features/student-portal/my-submission-section.tsx', import.meta.url), 'utf-8')

  it('explains what happens instead of hiding "ส่งงาน"', () => {
    expect(section).toContain("submission?.status === 'excused' && (")
    expect(section).toContain('ครูยกเว้นงานนี้ให้แล้ว ไม่ต้องส่งก็ได้')
    // The button is still governed only by attached work, as before.
    expect(section).toContain('const canFinalize = resources.length > 0 && !finalizing && !ensuring')
  })
})

describe('migration 0030 (source guards)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0030_student_qr_submissions.sql', import.meta.url), 'utf-8')

  it('random token from the server RNG, one active identity per student', () => {
    expect(sql).toContain("replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')")
    expect(sql).toMatch(/create unique index if not exists student_qr_identities_one_active_idx\s+on public\.student_qr_identities \(student_id\)\s+where status = 'active'/)
    expect(sql).toContain("on conflict (student_id) where status = 'active' do nothing")
  })

  it('internal helpers are closed to clients; only the RPCs are granted', () => {
    for (const fn of ['qr_record_submission(public.assignments, uuid, text)', 'issue_student_qr_identity(uuid)', 'qr_require_assignment(uuid)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`)
      expect(sql).not.toContain(`grant execute on function public.${fn}`)
    }
    for (const fn of ['record_submission_scan(uuid, text)', 'record_submission_manual(uuid, uuid)', 'correct_submission_status(uuid, uuid, text, text)', 'get_classroom_student_qr_codes(uuid)', 'regenerate_student_qr_code(uuid, uuid)']) {
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`)
    }
    expect(sql).toContain('revoke all on table public.student_qr_identities from anon, authenticated;')
  })

  it('server time, duplicate-safe, score never written', () => {
    expect(sql).toContain('v_now timestamptz := now();')
    expect(sql).toContain('on conflict (assignment_id, student_id) do nothing')
    expect(sql).toMatch(/for update;\s+if v_previous\.status in \('submitted', 'late'\) then/)
    expect(sql).not.toMatch(/set[^;]*\bscore\s*=/i)
    expect(sql).not.toMatch(/\bdelete from public\.(assignment_submissions|students|assignments)\b/i)
  })

  it('students cannot excuse themselves', () => {
    expect(sql).toContain("raise exception 'students cannot excuse their own submission'")
  })
})
