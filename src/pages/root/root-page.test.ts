import { describe, expect, it } from 'vitest'

import { deriveStudentRootDestination } from '@/pages/root/root-page'
import type { StudentAccountLinkRequest } from '@/types/student-link-request'

function request(
  id: string,
  status: StudentAccountLinkRequest['status'],
  createdAt: string,
): StudentAccountLinkRequest {
  return {
    id,
    studentId: `student-${id}`,
    requestedBy: 'me',
    status,
    reviewedBy: status === 'pending' ? null : 'teacher-1',
    reviewedAt: status === 'pending' ? null : createdAt,
    reviewNote: null,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('deriveStudentRootDestination — where "/" sends a signed-in student', () => {
  it('sends a student with no request history to the link-account form', () => {
    expect(deriveStudentRootDestination([])).toBe('/student/link-account')
  })

  it('sends a student with a pending request to /student/pending', () => {
    expect(deriveStudentRootDestination([request('a', 'pending', '2026-01-01T00:00:00Z')])).toBe(
      '/student/pending',
    )
  })

  it('sends a student with an approved request straight to /student/dashboard', () => {
    expect(deriveStudentRootDestination([request('a', 'approved', '2026-01-01T00:00:00Z')])).toBe(
      '/student/dashboard',
    )
  })

  it('sends a student with a rejected request to /student/pending (its retry view)', () => {
    expect(deriveStudentRootDestination([request('a', 'rejected', '2026-01-01T00:00:00Z')])).toBe(
      '/student/pending',
    )
  })

  it('uses the most recent request when history has multiple entries', () => {
    const older = request('a', 'rejected', '2026-01-01T00:00:00Z')
    const newer = request('b', 'approved', '2026-01-05T00:00:00Z')
    expect(deriveStudentRootDestination([older, newer])).toBe('/student/dashboard')
  })
})
