import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

describe('/student/subjects/:subjectId/assignments/:assignmentId route wiring', () => {
  it('is registered in router.tsx', () => {
    const source = readSource('../../../app/router.tsx')
    expect(source).toContain("path: 'subjects/:subjectId/assignments/:assignmentId'")
    expect(source).toContain('StudentAssignmentDetailPage')
  })

  it('the Subject Workspace งาน tab links each assignment title to this detail page', () => {
    const source = readSource('./student-subject-detail-page.tsx')
    expect(source).toContain('buildStudentAssignmentDetailPath(a.subjectId, a.id)')
  })
})

describe('StudentAssignmentDetailPage — page-level error isolation (Section 10)', () => {
  const source = readSource('./student-assignment-detail-page.tsx')

  it('gives subject identity and the assignment itself independent loading + error state', () => {
    expect(source).toContain('subjectLoading')
    expect(source).toContain('subjectError')
    expect(source).toContain('assignmentLoading')
    expect(source).toContain('assignmentError')
  })

  it('a failure resolving teacherId/studentId only disables ส่งงานของฉัน — title/description/due date/resources still render', () => {
    expect(source).toMatch(/classroomError \?\? profileError/)
    expect(source).toContain('AssignmentResourcesDisclosure')
  })

  it('embeds MySubmissionSection for the actual "ส่งงานของฉัน" workflow', () => {
    expect(source).toContain('MySubmissionSection')
  })
})

describe('StudentAssignmentDetailPage — header status badge (audit requirement 8, "ตรวจแล้ว")', () => {
  const source = readSource('./student-assignment-detail-page.tsx')

  it('derives the header badge via the shared deriveStudentFacingStatus, never a locally re-implemented ternary', () => {
    expect(source).toContain('deriveStudentFacingStatus(assignment)')
    expect(source).toContain('STUDENT_SUBMISSION_STATUS_LABEL[status]')
    expect(source).not.toMatch(/assignment\.status === 'submitted' \? 'success'/)
  })
})
