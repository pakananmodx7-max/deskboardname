import { describe, expect, it } from 'vitest'

import { getAssignmentsForClassroom, getStudentIdsForClassrooms, getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoClassroomInfo, DemoStudent, DemoSubjectAssignment } from '@/demo/types'

const classrooms: DemoClassroomInfo[] = [
  { id: 'room-1', name: 'ม.5/1', studentIds: ['s1', 's2'] },
  { id: 'room-2', name: 'ม.5/2', studentIds: ['s3'] },
]

function student(id: string): DemoStudent {
  return {
    id,
    number: 1,
    studentCode: id,
    firstName: id,
    lastName: 'test',
    nickname: '',
    classroom: '',
    status: 'active',
  }
}

const allStudents: DemoStudent[] = [student('s1'), student('s2'), student('s3')]

describe('getStudentsForClassrooms — subject workspace classroom scoping', () => {
  it('returns only the selected classroom’s students, not the other linked classroom’s', () => {
    const students = getStudentsForClassrooms(['room-1'], classrooms, allStudents)
    expect(students.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('switching to a different classroom id returns that classroom’s students instead', () => {
    const room1Students = getStudentsForClassrooms(['room-1'], classrooms, allStudents).map((s) => s.id)
    const room2Students = getStudentsForClassrooms(['room-2'], classrooms, allStudents).map((s) => s.id)
    expect(room1Students).toEqual(['s1', 's2'])
    expect(room2Students).toEqual(['s3'])
  })

  it('returns an empty roster for a classroom id that matches nothing', () => {
    expect(getStudentsForClassrooms(['does-not-exist'], classrooms, allStudents)).toEqual([])
  })
})

describe('getStudentIdsForClassrooms', () => {
  it('scopes to exactly the requested classroom, not every linked classroom', () => {
    expect(getStudentIdsForClassrooms(['room-2'], classrooms).sort()).toEqual(['s3'])
  })
})

function assignment(id: string, classroomId: string, title: string): DemoSubjectAssignment {
  return {
    id,
    subjectId: 'subject-science',
    classroomId,
    topicId: null,
    title,
    type: 'worksheet',
    maxScore: 10,
    dueDate: '2026-09-15',
    description: '',
    isArchived: false,
    submissions: {},
  }
}

describe('getAssignmentsForClassroom — never merges assignments across a subject’s linked classrooms', () => {
  const assignments: DemoSubjectAssignment[] = [
    assignment('a1', 'room-1', 'ใบงานเรื่องแรง'),
    assignment('a2', 'room-1', 'Quiz 1'),
    // same title as a1, but belongs to a different classroom — must stay a separate row.
    assignment('a3', 'room-2', 'ใบงานเรื่องแรง'),
    assignment('a4', 'room-2', 'Project'),
    assignment('a5', 'subject-other', 'ไม่เกี่ยวข้อง'),
  ]

  it('returns only the selected classroom’s assignments for the subject', () => {
    expect(getAssignmentsForClassroom(assignments, 'subject-science', 'room-1').map((a) => a.id)).toEqual([
      'a1',
      'a2',
    ])
  })

  it('a same-titled assignment in another linked classroom is a distinct row, not shared', () => {
    const room1 = getAssignmentsForClassroom(assignments, 'subject-science', 'room-1')
    const room2 = getAssignmentsForClassroom(assignments, 'subject-science', 'room-2')
    expect(room1.map((a) => a.id)).not.toContain('a3')
    expect(room2.map((a) => a.id)).toEqual(['a3', 'a4'])
  })

  it('excludes assignments belonging to a different subject entirely', () => {
    const results = getAssignmentsForClassroom(assignments, 'subject-science', 'room-1')
    expect(results.some((a) => a.id === 'a5')).toBe(false)
  })

  it('returns an empty list for a classroom with no assignments', () => {
    expect(getAssignmentsForClassroom(assignments, 'subject-science', 'room-does-not-exist')).toEqual([])
  })
})
