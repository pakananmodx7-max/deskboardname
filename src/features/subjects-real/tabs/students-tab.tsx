import { useEffect, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getSubjectClassrooms, getSubjectStudents } from '@/services/subject-service'
import type { Subject, SubjectClassroom, SubjectStudentView } from '@/types/subject'

import { SubjectStudentDrawer } from '../subject-student-drawer'

interface StudentsTabProps {
  subject: Subject
}

export function StudentsTab({ subject }: StudentsTabProps) {
  const [classrooms, setClassrooms] = useState<SubjectClassroom[]>([])
  const [classroomFilter, setClassroomFilter] = useState('all')
  const [students, setStudents] = useState<SubjectStudentView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewingStudent, setViewingStudent] = useState<SubjectStudentView | null>(null)

  useEffect(() => {
    let active = true
    getSubjectClassrooms(subject.id)
      .then((rows) => {
        if (active) setClassrooms(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [subject.id])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getSubjectStudents(subject.id, classroomFilter === 'all' ? undefined : classroomFilter)
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
  }, [subject.id, classroomFilter])

  return (
    <div className="space-y-4">
      <NativeSelect
        value={classroomFilter}
        onChange={(e) => setClassroomFilter(e.target.value)}
        className="w-auto"
        aria-label="กรองตามห้องเรียน"
      >
        <option value="all">ทุกห้องเรียน</option>
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.classroomId}>
            {classroom.classroomName}
          </option>
        ))}
      </NativeSelect>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">ห้อง</th>
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
                      ยังไม่มีนักเรียนในรายวิชานี้
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
                      <td className="px-5 py-3 text-muted-foreground">{student.classroomName}</td>
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

      <SubjectStudentDrawer
        subjectName={subject.name}
        student={viewingStudent}
        onOpenChange={(open) => !open && setViewingStudent(null)}
      />
    </div>
  )
}
