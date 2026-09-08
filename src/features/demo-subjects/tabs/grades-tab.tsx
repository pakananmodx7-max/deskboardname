import { Card, CardContent } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeSubjectGrades, getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoSubject } from '@/demo/types'

interface GradesTabProps {
  subject: DemoSubject
  classroomId: string
}

/** Displayed rows are scoped to the selected classroom (never merges
 * grade rows from the subject's other linked classrooms) — assignment
 * definitions/submissions themselves stay subject-wide in this demo data
 * model; only which student ROWS are shown is filtered here. */
export function GradesTab({ subject, classroomId }: GradesTabProps) {
  const { classrooms, allStudents, subjectAssignments } = useDemoClassroom()

  const students = getStudentsForClassrooms([classroomId], classrooms, allStudents).sort(
    (a, b) => a.number - b.number,
  )
  const assignments = subjectAssignments.filter((a) => a.subjectId === subject.id)
  const rows = computeSubjectGrades(
    students.map((s) => s.id),
    assignments,
  )
  const rowById = Object.fromEntries(rows.map((r) => [r.studentId, r]))

  if (assignments.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          ยังไม่มีงานในรายวิชานี้ — เพิ่มงานในแท็บ &ldquo;งาน&rdquo; ก่อน เพื่อดูตารางคะแนน
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="sticky left-0 bg-card px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                {assignments.map((assignment) => (
                  <th key={assignment.id} className="px-3 py-3 text-center font-medium">
                    {assignment.title}
                    <div className="font-normal">/{assignment.maxScore}</div>
                  </th>
                ))}
                <th className="px-3 py-3 text-center font-medium">Total</th>
                <th className="px-3 py-3 text-center font-medium">Average</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const row = rowById[student.id]
                return (
                  <tr key={student.id} className="border-b border-border last:border-0">
                    <td className="sticky left-0 whitespace-nowrap bg-card px-5 py-2 font-medium">
                      {student.number}. {student.firstName} {student.lastName}
                    </td>
                    {assignments.map((assignment) => {
                      const score = row?.scoresByAssignment[assignment.id] ?? null
                      return (
                        <td key={assignment.id} className="px-3 py-2 text-center text-muted-foreground">
                          {score !== null ? score : '-'}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center font-semibold">{row?.total ?? 0}</td>
                    <td className="px-3 py-2 text-center text-muted-foreground">
                      {row?.average !== null && row?.average !== undefined ? `${row.average.toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
