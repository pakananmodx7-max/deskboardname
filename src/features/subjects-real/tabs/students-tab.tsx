import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { buildStudentAnalyticsPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getStudentsByClassroom } from '@/services/student-service'
import type { ClassroomStudent } from '@/types/student'

import { SubjectStudentDrawer } from '../subject-student-drawer'

interface StudentsTabProps {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
}

/**
 * Scoped to exactly one classroom (the one selected in the subject
 * workspace header) — never merges students from the subject's other
 * linked classrooms. Reads directly from classroom_students via
 * getStudentsByClassroom (student-service.ts), the same real roster
 * every other classroom-scoped screen in the app uses, rather than the
 * subject-wide getSubjectStudents derivation.
 */
export function StudentsTab({ subjectId, subjectName, classroomId, classroomName }: StudentsTabProps) {
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewingStudent, setViewingStudent] = useState<ClassroomStudent | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getStudentsByClassroom(classroomId)
      .then((rows) => {
        if (active) setStudents(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [classroomId])

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">สถานะ</th>
                  <th className="w-12 px-3 py-3" aria-label="ตัวเลือก" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
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
                      <td className="px-5 py-3 text-muted-foreground">{student.number ?? '-'}</td>
                      <td className="px-5 py-3 font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {student.status === 'active' ? 'กำลังเรียน' : 'ไม่ได้ใช้งาน'}
                      </td>
                      <td className="px-3 py-2">
                        {/* The row click still opens the drawer; the ⋮ trigger
                         * stops propagation (RowActionsMenu), so choosing an
                         * item never also triggers the row. */}
                        <RowActionsMenu
                          actions={[
                            { key: 'view', label: 'ดูรายละเอียด', onSelect: () => setViewingStudent(student) },
                            {
                              key: 'analytics',
                              label: 'วิเคราะห์รายบุคคล',
                              onSelect: () => navigate(buildStudentAnalyticsPath(subjectId, classroomId, student.id)),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <SubjectStudentDrawer
        subjectId={subjectId}
        subjectName={subjectName}
        classroomId={classroomId}
        classroomName={classroomName}
        student={viewingStudent}
        onOpenChange={(open) => !open && setViewingStudent(null)}
      />
    </div>
  )
}
