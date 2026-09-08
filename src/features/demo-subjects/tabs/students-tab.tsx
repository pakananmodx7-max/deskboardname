import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoStudent, DemoSubject } from '@/demo/types'
import { SubjectStudentDrawer } from '@/features/demo-subjects/subject-student-drawer'

interface StudentsTabProps {
  subject: DemoSubject
  classroomId: string
}

/** Scoped to exactly one of the subject's linked classrooms — the one
 * selected in the workspace header — never merges students from the
 * subject's other linked classrooms. Mirrors subjects-real's
 * StudentsTab, which is scoped the same way against real data. */
export function StudentsTab({ subject, classroomId }: StudentsTabProps) {
  const { classrooms, allStudents, subjectAssignments } = useDemoClassroom()
  const [viewingStudent, setViewingStudent] = useState<DemoStudent | null>(null)

  const students = getStudentsForClassrooms([classroomId], classrooms, allStudents).sort(
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
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">งานค้าง</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr
                      key={student.id}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50"
                      onClick={() => setViewingStudent(student)}
                    >
                      <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                      <td className="px-5 py-3 font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{missingCountFor(student.id)} งาน</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <SubjectStudentDrawer
        subject={subject}
        classroomId={classroomId}
        student={viewingStudent}
        onOpenChange={(open) => !open && setViewingStudent(null)}
      />
    </div>
  )
}
