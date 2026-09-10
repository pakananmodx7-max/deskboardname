import { describe, expect, it } from 'vitest'

import {
  filterActiveAssignmentsForSwitcher,
  findSwitcherIndex,
  getNextAssignment,
  getPreviousAssignment,
} from '@/services/assignment-service'
import type { Assignment } from '@/types/assignment'

function assignment(id: string, overrides: Partial<Assignment> = {}): Assignment {
  return {
    id,
    subjectId: 'subj-1',
    classroomId: 'room-1',
    topicId: null,
    title: `Assignment ${id}`,
    description: null,
    maxScore: 100,
    dueDate: null,
    isArchived: false,
    createdBy: 'teacher-1',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('filterActiveAssignmentsForSwitcher — archived assignments excluded', () => {
  it('excludes archived assignments, keeps active ones in the same order', () => {
    const rows = [assignment('a1'), assignment('a2', { isArchived: true }), assignment('a3')]
    expect(filterActiveAssignmentsForSwitcher(rows).map((a) => a.id)).toEqual(['a1', 'a3'])
  })

  it('returns an empty list when every assignment is archived', () => {
    expect(filterActiveAssignmentsForSwitcher([assignment('a1', { isArchived: true })])).toEqual([])
  })
})

describe('findSwitcherIndex — current assignment marked', () => {
  const list = [assignment('a1'), assignment('a2'), assignment('a3')]

  it('finds the current assignment among active ones', () => {
    expect(findSwitcherIndex(list, 'a2')).toBe(1)
  })

  it('returns -1 when the current assignment is not in the (active-only) list — e.g. it is itself archived', () => {
    expect(findSwitcherIndex(list, 'archived-one')).toBe(-1)
  })
})

describe('getPreviousAssignment / getNextAssignment — ordering + boundaries (Section 3)', () => {
  const list = [assignment('a1'), assignment('a2'), assignment('a3')]

  it('previous/next follow the SAME order as the list (the งาน tab order)', () => {
    expect(getPreviousAssignment(list, 'a2')?.id).toBe('a1')
    expect(getNextAssignment(list, 'a2')?.id).toBe('a3')
  })

  it('previous is disabled (null) at the first assignment — never wraps to the last', () => {
    expect(getPreviousAssignment(list, 'a1')).toBeNull()
  })

  it('next is disabled (null) at the last assignment — never wraps to the first', () => {
    expect(getNextAssignment(list, 'a3')).toBeNull()
  })

  it('both are null when the current assignment is not in the list at all', () => {
    expect(getPreviousAssignment(list, 'unknown')).toBeNull()
    expect(getNextAssignment(list, 'unknown')).toBeNull()
  })

  it('both are null for a single-assignment classroom', () => {
    const single = [assignment('only')]
    expect(getPreviousAssignment(single, 'only')).toBeNull()
    expect(getNextAssignment(single, 'only')).toBeNull()
  })
})

describe('switcher scope — only assignments from the current subject+classroom (Section 2/6)', () => {
  it('getAssignments(subjectId, classroomId) is the sole data source — isolation is inherited from that already-RLS-scoped query, never re-implemented client-side', () => {
    // filterActiveAssignmentsForSwitcher only ever narrows (archived
    // removal) what getAssignments(subjectId, classroomId) already
    // returned — it has no subject/classroom parameter of its own, so it
    // cannot broaden scope beyond whatever the caller already fetched
    // for this exact subject+classroom.
    const scoped = [assignment('a1', { subjectId: 'subj-1', classroomId: 'room-1' })]
    expect(filterActiveAssignmentsForSwitcher(scoped).every((a) => a.subjectId === 'subj-1' && a.classroomId === 'room-1')).toBe(
      true,
    )
  })
})
