import { Plus, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AddStudentDialog } from '@/features/student-management/add-student-dialog'
import { StudentImportDialog } from '@/features/student-import/student-import-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Classroom } from '@/types/classroom'
import type { ClassroomStudent } from '@/types/student'

interface ClassroomStudentsTabProps {
  classroom: Classroom
}

export function ClassroomStudentsTab({ classroom }: ClassroomStudentsTabProps) {
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getStudentsByClassroom(classroom.id)
      .then(setStudents)
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [classroom.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{loading ? 'กำลังโหลด...' : `${students.length} คน`}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import Students
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            เพิ่มนักเรียน
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">รหัสนักเรียน</th>
                  <th className="px-5 py-3 font-medium">สถานะ</th>
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
                    <tr key={student.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 text-muted-foreground">{student.number ?? '-'}</td>
                      <td className="px-5 py-3 font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{student.studentCode ?? '-'}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {student.status === 'active' ? 'กำลังเรียน' : 'ไม่ได้ใช้งาน'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AddStudentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        classrooms={[classroom]}
        defaultClassroomId={classroom.id}
        onCreated={refresh}
      />
      <StudentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        classroomId={classroom.id}
        onImported={refresh}
      />
    </div>
  )
}
