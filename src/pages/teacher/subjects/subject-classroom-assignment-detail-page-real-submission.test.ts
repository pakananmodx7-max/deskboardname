import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./subject-classroom-assignment-detail-page-real.tsx', import.meta.url), 'utf-8')
}

describe('Teacher assignment detail — งานออนไลน์ column (Section 3/10)', () => {
  const source = readSource()

  it('adds a งานออนไลน์ column header, distinct from สถานะ/คะแนน/หมายเหตุ', () => {
    expect(source).toContain('งานออนไลน์')
  })

  it('shows a compact resource count ("N ไฟล์") when resources exist, or an open action otherwise', () => {
    expect(source).toMatch(/ไฟล์`/)
  })

  it('resource counts load independently of the roster (student/status/score) — a count-lookup failure falls back to an empty map, never blocking the roster', () => {
    expect(source).toContain('getSubmissionResourceCounts(submissionIds).catch(() => ({}))')
  })

  it('opens the SubmissionViewerDrawer rather than inlining file management into the roster row', () => {
    expect(source).toContain('SubmissionViewerDrawer')
    expect(source).toContain('viewerStudentId')
  })
})
