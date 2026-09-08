import { describe, expect, it } from 'vitest'

import { deriveMyLinkStatus } from '@/services/student-link-service'
import type { StudentAccountLinkRequest } from '@/types/student-link-request'

function request(
  id: string,
  status: StudentAccountLinkRequest['status'],
  createdAt: string,
  reviewNote: string | null = null,
): StudentAccountLinkRequest {
  return {
    id,
    studentId: `student-${id}`,
    requestedBy: 'me',
    status,
    reviewedBy: status === 'pending' ? null : 'teacher-1',
    reviewedAt: status === 'pending' ? null : `${createdAt}`,
    reviewNote,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('deriveMyLinkStatus — routing/rendering for /student/login and /student/pending', () => {
  it('returns "none" when the account has never submitted a request', () => {
    expect(deriveMyLinkStatus([])).toEqual({ status: 'none' })
  })

  it('reflects the single request when there is only one', () => {
    const r = request('a', 'pending', '2026-01-01T00:00:00Z')
    const result = deriveMyLinkStatus([r])
    expect(result).toEqual({ status: 'pending', request: r })
  })

  it('picks the MOST RECENT request when there is a history (e.g. rejected, then a retry)', () => {
    const older = request('a', 'rejected', '2026-01-01T00:00:00Z', 'รหัสไม่ตรง')
    const newer = request('b', 'pending', '2026-01-02T00:00:00Z')
    const result = deriveMyLinkStatus([older, newer])
    expect(result).toEqual({ status: 'pending', request: newer })
  })

  it('does not depend on array order — the newest wins regardless of position', () => {
    const older = request('a', 'rejected', '2026-01-01T00:00:00Z')
    const newer = request('b', 'approved', '2026-01-05T00:00:00Z')
    expect(deriveMyLinkStatus([newer, older])).toEqual({ status: 'approved', request: newer })
    expect(deriveMyLinkStatus([older, newer])).toEqual({ status: 'approved', request: newer })
  })

  it('surfaces the review note on a rejected request, for the retry-with-context UI', () => {
    const r = request('a', 'rejected', '2026-01-01T00:00:00Z', 'รหัสนักเรียนไม่ตรงกับข้อมูลในระบบ')
    const result = deriveMyLinkStatus([r])
    expect(result.status).toBe('rejected')
    if (result.status !== 'none') {
      expect(result.request.reviewNote).toBe('รหัสนักเรียนไม่ตรงกับข้อมูลในระบบ')
    }
  })
})
