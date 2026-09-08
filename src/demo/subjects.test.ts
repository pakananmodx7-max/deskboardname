import { describe, expect, it } from 'vitest'

import { buildInitialSubjectAssignments } from '@/demo/subjects'

/** Fake resolver standing in for demo-context's real
 * studentIdsForClassrooms(['classroom-1']) / (['classroom-2']) — only the
 * two classroom ids the seed function actually asks for matter here. */
function studentIdsByClassroomIds(classroomIds: string[]): string[] {
  if (classroomIds.includes('classroom-1')) return ['s1', 's2', 's3']
  if (classroomIds.includes('classroom-2')) return ['s4', 's5']
  return []
}

describe('buildInitialSubjectAssignments — classroom-1 and classroom-2 get independent assignment sets', () => {
  const assignments = buildInitialSubjectAssignments(studentIdsByClassroomIds)
  const classroom1 = assignments.filter((a) => a.classroomId === 'classroom-1')
  const classroom2 = assignments.filter((a) => a.classroomId === 'classroom-2')

  it('classroom-1 and classroom-2 assignments are disjoint by id', () => {
    const ids1 = new Set(classroom1.map((a) => a.id))
    const ids2 = new Set(classroom2.map((a) => a.id))
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false)
    }
  })

  it('a same-titled assignment ("ใบงานเรื่องแรง") exists independently in both classrooms', () => {
    const title1 = classroom1.filter((a) => a.title === 'ใบงานเรื่องแรง')
    const title2 = classroom2.filter((a) => a.title === 'ใบงานเรื่องแรง')
    expect(title1).toHaveLength(1)
    expect(title2).toHaveLength(1)
    expect(title1[0].id).not.toBe(title2[0].id)
  })

  it('classroom-2 has its own assignments not present in classroom-1 (e.g. no Quiz บทที่ 1)', () => {
    expect(classroom2.some((a) => a.title === 'Quiz บทที่ 1')).toBe(false)
    expect(classroom1.some((a) => a.title === 'Quiz บทที่ 1')).toBe(true)
  })

  it('every assignment’s submissions are only for that classroom’s own students', () => {
    for (const assignment of classroom1) {
      expect(Object.keys(assignment.submissions).every((id) => ['s1', 's2', 's3'].includes(id))).toBe(true)
    }
    for (const assignment of classroom2) {
      expect(Object.keys(assignment.submissions).every((id) => ['s4', 's5'].includes(id))).toBe(true)
    }
  })

  it('every assignment starts unarchived', () => {
    expect(assignments.every((a) => a.isArchived === false)).toBe(true)
  })
})
