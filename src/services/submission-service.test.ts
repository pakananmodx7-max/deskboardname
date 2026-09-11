import { describe, expect, it } from 'vitest'

import {
  deriveStudentFacingStatus,
  STUDENT_SUBMISSION_STATUS_BADGE_VARIANT,
  STUDENT_SUBMISSION_STATUS_LABEL,
  SUBMISSION_FILE_MAX_BYTES,
  buildSubmissionResourcePath,
  computeNextSubmissionResourceSortOrder,
  computeSubmissionStatusOnSubmit,
  generateSubmissionFileName,
  submissionResourceTypeLabel,
  validateSubmissionResourceFile,
  validateSubmissionResourceTitle,
  validateSubmissionResourceUrl,
  validateSubmissionTextContent,
} from '@/services/submission-service'
import type { SubmissionResource } from '@/types/submission'

function resource(id: string, sortOrder: number): SubmissionResource {
  return {
    id,
    submissionId: 'sub-1',
    resourceType: 'link',
    title: `resource ${sortOrder}`,
    storagePath: null,
    externalUrl: 'https://example.com',
    textContent: null,
    originalFilename: null,
    mimeType: null,
    fileSize: null,
    sortOrder,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    deletedAt: null,
  }
}

describe('computeSubmissionStatusOnSubmit — before/late deadline (Section 2 required tests)', () => {
  it('returns submitted when there is no due date at all', () => {
    expect(computeSubmissionStatusOnSubmit(null, new Date('2026-09-10T10:00:00Z'))).toBe('submitted')
  })

  it('returns submitted for a submission any time ON the due date (treated through 23:59:59)', () => {
    expect(computeSubmissionStatusOnSubmit('2026-09-10', new Date('2026-09-10T23:59:00'))).toBe('submitted')
  })

  it('returns submitted for a submission well before the due date', () => {
    expect(computeSubmissionStatusOnSubmit('2026-09-15', new Date('2026-09-10T10:00:00'))).toBe('submitted')
  })

  it('returns late for a submission any time AFTER the due date', () => {
    expect(computeSubmissionStatusOnSubmit('2026-09-10', new Date('2026-09-11T00:00:01'))).toBe('late')
  })
})

describe('deriveStudentFacingStatus — the one shared "ตรวจแล้ว" derivation (audit requirement 8)', () => {
  it('returns not_submitted for a null submission (student has never touched this assignment)', () => {
    expect(deriveStudentFacingStatus(null)).toBe('not_submitted')
  })

  it('returns the raw status (submitted/late/missing) when reviewedAt is not set', () => {
    expect(deriveStudentFacingStatus({ status: 'submitted', reviewedAt: null })).toBe('submitted')
    expect(deriveStudentFacingStatus({ status: 'late', reviewedAt: null })).toBe('late')
    expect(deriveStudentFacingStatus({ status: 'missing', reviewedAt: null })).toBe('missing')
  })

  it('returns "reviewed" once a teacher has recorded a score (reviewedAt set), regardless of the underlying status', () => {
    expect(deriveStudentFacingStatus({ status: 'submitted', reviewedAt: '2026-09-05T00:00:00Z' })).toBe('reviewed')
    expect(deriveStudentFacingStatus({ status: 'late', reviewedAt: '2026-09-05T00:00:00Z' })).toBe('reviewed')
  })

  it('treats a missing reviewedAt field (undefined, not just null) the same as unreviewed', () => {
    expect(deriveStudentFacingStatus({ status: 'submitted' })).toBe('submitted')
  })

  it('every StudentFacingSubmissionStatus value has both a label and a badge variant, including the new "reviewed" state', () => {
    const statuses = ['not_submitted', 'submitted', 'late', 'missing', 'reviewed'] as const
    for (const status of statuses) {
      expect(STUDENT_SUBMISSION_STATUS_LABEL[status]).toBeTruthy()
      expect(STUDENT_SUBMISSION_STATUS_BADGE_VARIANT[status]).toBeTruthy()
    }
    expect(STUDENT_SUBMISSION_STATUS_LABEL.reviewed).toBe('ตรวจแล้ว')
  })
})

describe('validateSubmissionResourceUrl — invalid URL rejection (Section 13 required test)', () => {
  it('accepts a well-formed https:// URL', () => {
    expect(validateSubmissionResourceUrl('https://drive.google.com/file/d/abc')).toBeNull()
  })

  it('rejects non-https and malformed URLs', () => {
    expect(validateSubmissionResourceUrl('http://example.com')).not.toBeNull()
    expect(validateSubmissionResourceUrl('javascript:alert(1)')).not.toBeNull()
    expect(validateSubmissionResourceUrl('')).not.toBeNull()
    expect(validateSubmissionResourceUrl('not a url')).not.toBeNull()
  })
})

describe('validateSubmissionResourceTitle / validateSubmissionTextContent', () => {
  it('rejects empty/whitespace-only values', () => {
    expect(validateSubmissionResourceTitle('   ')).not.toBeNull()
    expect(validateSubmissionTextContent('')).not.toBeNull()
  })

  it('accepts real content', () => {
    expect(validateSubmissionResourceTitle('งานของฉัน')).toBeNull()
    expect(validateSubmissionTextContent('คำตอบของฉัน')).toBeNull()
  })
})

describe('validateSubmissionResourceFile', () => {
  it('accepts every allowed type, including ZIP (Section 1 "optionally ZIP")', () => {
    expect(validateSubmissionResourceFile({ type: 'application/pdf', size: 1024 } as File)).toBeNull()
    expect(validateSubmissionResourceFile({ type: 'application/zip', size: 1024 } as File)).toBeNull()
    expect(validateSubmissionResourceFile({ type: 'application/x-zip-compressed', size: 1024 } as File)).toBeNull()
    expect(
      validateSubmissionResourceFile({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 1024,
      } as File),
    ).toBeNull()
  })

  it('rejects an unsupported file type', () => {
    expect(validateSubmissionResourceFile({ type: 'video/mp4', size: 1024 } as File)).not.toBeNull()
  })

  it('rejects a file over the 25MB limit', () => {
    expect(validateSubmissionResourceFile({ type: 'application/pdf', size: SUBMISSION_FILE_MAX_BYTES + 1 } as File)).not.toBeNull()
  })
})

describe('generateSubmissionFileName / buildSubmissionResourcePath', () => {
  it('never uses the original filename — always <uuid>.<ext>', () => {
    expect(generateSubmissionFileName('application/pdf')).toMatch(/^[0-9a-f-]{36}\.pdf$/)
  })

  it('builds the exact 7-segment path shape from 0016', () => {
    expect(buildSubmissionResourcePath('t1', 's1', 'c1', 'a1', 'stu1', 'sub1', 'x.pdf')).toBe('t1/s1/c1/a1/stu1/sub1/x.pdf')
  })
})

describe('computeNextSubmissionResourceSortOrder', () => {
  it('appends to the end of an existing resource list', () => {
    expect(computeNextSubmissionResourceSortOrder([resource('r1', 0), resource('r2', 4)])).toBe(5)
  })

  it('starts at 0 for the first resource', () => {
    expect(computeNextSubmissionResourceSortOrder([])).toBe(0)
  })
})

describe('submissionResourceTypeLabel', () => {
  it('labels all three resource types in Thai', () => {
    expect(submissionResourceTypeLabel('file')).toBe('ไฟล์')
    expect(submissionResourceTypeLabel('link')).toBe('ลิงก์')
    expect(submissionResourceTypeLabel('text')).toBe('ข้อความ')
  })
})
