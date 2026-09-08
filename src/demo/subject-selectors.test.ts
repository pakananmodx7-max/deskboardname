import { describe, expect, it } from 'vitest'

import { getStudentIdsForClassrooms, getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoClassroomInfo, DemoStudent } from '@/demo/types'

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
