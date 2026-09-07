import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoStudent, DemoSubject } from '@/demo/types'
import { SubjectStudentDrawer } from '@/features/demo-subjects/subject-student-drawer'

interface StudentsTabProps {
  subject: DemoSubject
}

export function StudentsTab({ subject }: StudentsTabProps) {
  const { classrooms, allStudents, subjectAssignments } = useDemoClassroom()
  const [classroomFilter, setClassroomFilter] = useState('all')
  const [viewingStudent, setViewingStudent] = useState<DemoStudent | null>(null)

  const subjectClassrooms = classrooms.filter((c) => subject.classroomIds.includes(c.id))
  const filterClassroomIds = classroomFilter === 'all' ? subject.classroomIds : [classroomFilter]
  const students = getStudentsForClassrooms(filterClassroomIds, classrooms, allStudents).sort(
    (a, b) => a.number - b.number,
  )
  const assignments = subjectAssignments.filter((a) => a.subjectId === subject.id)

  function missingCountFor(studentId: string): number {
    return assignments.filter((a) => {
      const status = a.submissions[studentId]?.status
      return status === 'not_submitted' || status === 'late' || status === 'missing'
    }).length
  }

  return (
    <div className="space-y-4">
      <NativeSelect
        value={classroomFilter}
        onChange={(e) => setClassroomFilter(e.target.value)}
        className="w-auto"
        aria-label="กรองตามห้องเรียน"
      >
        <option value="all">All</option>
        {subjectClassrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.name}
          </option>
        ))}
      </NativeSelect>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">ห้อง</th>
                  <th className="px-5 py-3 font-medium">งานค้าง</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr
                    key={student.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50"
                    onClick={() => setViewingStudent(student)}
                  >
                    <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                    <td className="px-5 py-3 font-medium">
                      {student.firstName} {student.lastName}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{student.classroom}</td>
                    <td className="px-5 py-3 text-muted-foreground">{missingCountFor(student.id)} งาน</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <SubjectStudentDrawer
        subject={subject}
        student={viewingStudent}
        onOpenChange={(open) => !open && setViewingStudent(null)}
      />
    </div>
  )
}
