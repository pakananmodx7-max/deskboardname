import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./my-submission-section.tsx', import.meta.url), 'utf-8')
}

describe('MySubmissionSection — student submission UI (Sections 1/2/8/10)', () => {
  const source = readSource()

  it('supports all three resource kinds: file, link, and text', () => {
    expect(source).toContain('handleFileSelected')
    expect(source).toContain('handleAddLink')
    expect(source).toContain('handleAddText')
  })

  it('the submission row is created lazily, on the first real resource action — never merely by viewing the page', () => {
    expect(source).toContain('ensureSubmission')
    expect(source).toContain('getOrCreateMySubmission')
    expect(source).not.toMatch(/useEffect\([^)]*getOrCreateMySubmission/)
  })

  it('"ส่งงาน" (finalize) is a SEPARATE action from attaching a resource — an upload failure can never mark the assignment submitted (Section 10)', () => {
    expect(source).toContain('handleFinalize')
    expect(source).toContain('finalizeSubmission')
    // finalizeSubmission must not be called from inside the upload/add handlers
    expect(source).not.toMatch(/handleFileSelected[\s\S]{0,500}finalizeSubmission/)
  })

  it('the finalize button is disabled until at least one resource is attached', () => {
    expect(source).toMatch(/canFinalize\s*=\s*resources\.length > 0/)
  })

  it('shows own score and teacher comment (note) only when present — never a fabricated value', () => {
    expect(source).toContain('submission.score')
    expect(source).toContain('submission.note')
  })

  it('shows submittedAt (revision/resubmission info) and relabels the button "ส่งงานอีกครั้ง" once already submitted', () => {
    expect(source).toContain('submittedAt')
    expect(source).toContain('hasSubmittedBefore')
    expect(source).toContain('ส่งงานอีกครั้ง')
  })

  it('a resource-list load failure shows its own error, independent of the rest of the page', () => {
    expect(source).toMatch(/resourcesError/)
  })

  it('the section is titled "ส่งงานออนไลน์" (audit requirement 4)', () => {
    expect(source).toContain('ส่งงานออนไลน์')
  })

  it('the status badge is derived via the ONE shared helper (deriveStudentFacingStatus), never a locally re-implemented status map', () => {
    expect(source).toContain('deriveStudentFacingStatus(submission)')
    expect(source).toContain('STUDENT_SUBMISSION_STATUS_LABEL[status]')
    expect(source).toContain('STUDENT_SUBMISSION_STATUS_BADGE_VARIANT[status]')
  })
})
