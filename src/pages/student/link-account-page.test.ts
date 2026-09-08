import { describe, expect, it } from 'vitest'

import { pickDefaultClassroom } from '@/pages/student/link-account-page'
import type { StudentLinkClassroomOption } from '@/types/student-link-request'

function option(classroomId: string, classroomName: string): StudentLinkClassroomOption {
  return { classroomId, classroomName }
}

describe('pickDefaultClassroom — classroom-selector pre-selection on /student/link-account', () => {
  it('returns null when the code matched no classroom (nothing to select)', () => {
    expect(pickDefaultClassroom([])).toBeNull()
  })

  it('pre-selects the single classroom when the code is unambiguous', () => {
    const only = option('classroom-1', 'ม.5/1')
    expect(pickDefaultClassroom([only])).toBe('classroom-1')
  })

  it('does NOT pre-select when the same code exists in more than one classroom — the student must choose', () => {
    const a = option('classroom-1', 'ม.5/1')
    const b = option('classroom-2', 'ม.5/2')
    expect(pickDefaultClassroom([a, b])).toBeNull()
  })
})
