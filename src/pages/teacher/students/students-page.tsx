import { Plus, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getStudents } from '@/services/student-service'
import type { Student, StudentStatus } from '@/types/student'

const statusLabel: Record<StudentStatus, string> = {
  active: 'กำลังศึกษา',
  inactive: 'พ้นสภาพ',
  transferred: 'ย้ายโรงเรียน',
}

const statusVariant: Record<StudentStatus, 'success' | 'secondary' | 'outline'> = {
  active: 'success',
  inactive: 'secondary',
  transferred: 'outline',
}

export function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([])

  useEffect(() => {
    let active = true
    getStudents().then((result) => {
      if (active) setStudents(result)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายชื่อนักเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">ม.5/1 · {students.length} คน</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Upload className="size-4" />
            Import Students
          </Button>
          <Button>
            <Plus className="size-4" />
            เพิ่มนักเรียน
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">รหัสนักเรียน</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">ห้อง</th>
                  <th className="px-5 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                    <td className="px-5 py-3">{student.studentCode}</td>
                    <td className="px-5 py-3 font-medium">
                      {student.firstName} {student.lastName}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{student.classId}</td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariant[student.status]}>
                        {statusLabel[student.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
