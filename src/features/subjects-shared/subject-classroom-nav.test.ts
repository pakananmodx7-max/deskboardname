import { describe, expect, it } from 'vitest'

import {
  buildAssignmentDetailPath,
  buildClassroomTabPath,
  buildSubjectClassroomPath,
  buildSubjectClassroomTabPath,
  isClassroomLinkedToSubject,
  resolveAutoRedirectClassroomId,
  summarizeSubjectClassrooms,
} from '@/features/subjects-shared/subject-classroom-nav'

describe('resolveAutoRedirectClassroomId', () => {
  it('returns the classroom id when the subject has exactly one linked classroom', () => {
    expect(resolveAutoRedirectClassroomId([{ classroomId: 'c1' }])).toBe('c1')
  })

  it('returns null for a subject with multiple linked classrooms (show the picker)', () => {
    expect(resolveAutoRedirectClassroomId([{ classroomId: 'c1' }, { classroomId: 'c2' }, { classroomId: 'c3' }])).toBeNull()
  })

  it('returns null for a subject with zero linked classrooms', () => {
    expect(resolveAutoRedirectClassroomId([])).toBeNull()
  })
})

describe('isClassroomLinkedToSubject', () => {
  const links = [{ classroomId: 'c1' }, { classroomId: 'c2' }]

  it('accepts a classroom that is linked to the subject', () => {
    expect(isClassroomLinkedToSubject(links, 'c1')).toBe(true)
    expect(isClassroomLinkedToSubject(links, 'c2')).toBe(true)
  })

  it('rejects a classroom id not linked to this subject', () => {
    expect(isClassroomLinkedToSubject(links, 'someone-elses-classroom')).toBe(false)
  })

  it('rejects an undefined classroom id (missing route param)', () => {
    expect(isClassroomLinkedToSubject(links, undefined)).toBe(false)
  })

  it('rejects every classroom once the subject has none linked', () => {
    expect(isClassroomLinkedToSubject([], 'c1')).toBe(false)
  })
})

describe('summarizeSubjectClassrooms', () => {
  it('sums classroom count and student count across every linked classroom', () => {
    const links = [{ studentCount: 31 }, { studentCount: 35 }, { studentCount: 33 }]
    expect(summarizeSubjectClassrooms(links)).toEqual({ totalClassrooms: 3, totalStudents: 99 })
  })

  it('returns zeros for a subject with no linked classrooms', () => {
    expect(summarizeSubjectClassrooms([])).toEqual({ totalClassrooms: 0, totalStudents: 0 })
  })

  it('handles a single linked classroom', () => {
    expect(summarizeSubjectClassrooms([{ studentCount: 31 }])).toEqual({ totalClassrooms: 1, totalStudents: 31 })
  })
})

describe('buildSubjectClassroomPath', () => {
  it('builds the classroom-scoped workspace path', () => {
    expect(buildSubjectClassroomPath('subj-1', 'room-1')).toBe('/teacher/subjects/subj-1/classrooms/room-1')
  })
})

describe('buildAssignmentDetailPath — Dashboard deep links, correct subject+classroom', () => {
  it('builds the exact real assignment-detail route, never a deprecated flat route', () => {
    const path = buildAssignmentDetailPath('subj-1', 'room-1', 'assign-1')
    expect(path).toBe('/teacher/subjects/subj-1/classrooms/room-1/assignments/assign-1')
    expect(path).not.toContain('/teacher/assignments')
  })

  it('targets the exact subject and classroom passed in, never a different pair', () => {
    const path = buildAssignmentDetailPath('subj-A', 'room-B', 'assign-1')
    expect(path).toContain('subj-A')
    expect(path).toContain('room-B')
    expect(path).not.toContain('subj-B')
    expect(path).not.toContain('room-A')
  })
})

describe('buildSubjectClassroomTabPath — Dashboard "เช็คชื่อ"/"ให้คะแนน" deep links', () => {
  it('builds the workspace path with a ?tab= query string, never a deprecated flat route', () => {
    const path = buildSubjectClassroomTabPath('subj-1', 'room-1', 'attendance')
    expect(path).toBe('/teacher/subjects/subj-1/classrooms/room-1?tab=attendance')
    expect(path).not.toContain('/teacher/attendance')
  })

  it('supports every real workspace tab', () => {
    expect(buildSubjectClassroomTabPath('s', 'c', 'grades')).toContain('?tab=grades')
    expect(buildSubjectClassroomTabPath('s', 'c', 'assignments')).toContain('?tab=assignments')
    expect(buildSubjectClassroomTabPath('s', 'c', 'students')).toContain('?tab=students')
  })
})

describe('buildClassroomTabPath — Dashboard "ดูนักเรียน" deep link', () => {
  it('builds the classroom detail route with ?tab=students, targeting the exact classroom', () => {
    expect(buildClassroomTabPath('room-1', 'students')).toBe('/teacher/classrooms/room-1?tab=students')
  })
})
