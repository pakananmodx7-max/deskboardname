import { Loader2, Plus, Search, Upload, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SupabaseConfigNotice } from '@/components/shared/supabase-config-notice'
import { ClassroomSelector } from '@/features/classroom-management/classroom-selector'
import { NoClassroomsEmptyState } from '@/features/classroom-management/no-classrooms-empty-state'
import { AddStudentDialog } from '@/features/student-management/add-student-dialog'
import { StudentImportDialog } from '@/features/student-import/student-import-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { isSupabaseConfigured } from '@/lib/supabase'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Classroom } from '@/types/classroom'
import type { ClassroomStudent, StudentStatus } from '@/types/student'

const statusLabel: Record<StudentStatus, string> = {
  active: 'กำลังศึกษา',
  inactive: 'พ้นสภาพ',
}

const statusVariant: Record<StudentStatus, 'success' | 'secondary'> = {
  active: 'success',
  inactive: 'secondary',
}

export function StudentsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [classroomsLoading, setClassroomsLoading] = useState(isSupabaseConfigured)
  const [classroomsError, setClassroomsError] = useState<string | null>(null)
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null)

  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let active = true
    setClassroomsError(null)

    getClassrooms()
      .then((result) => {
        if (!active) return
        setClassrooms(result)
        setSelectedClassroomId((current) => current ?? result[0]?.id ?? null)
      })
      .catch((err) => {
        if (active) setClassroomsError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดรายชื่อห้องเรียนได้'))
      })
      .finally(() => {
        if (active) setClassroomsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedClassroomId) {
      setStudents([])
      return
    }

    let active = true
    setStudentsLoading(true)
    setStudentsError(null)

    getStudentsByClassroom(selectedClassroomId)
      .then((result) => {
        if (active) setStudents(result)
      })
      .catch((err) => {
        if (active) setStudentsError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดรายชื่อนักเรียนได้'))
      })
      .finally(() => {
        if (active) setStudentsLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedClassroomId, refreshToken])

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return students
    return students.filter((student) => {
      const fullName = `${student.firstName} ${student.lastName}`.toLowerCase()
      const code = (student.studentCode ?? '').toLowerCase()
      return fullName.includes(query) || code.includes(query)
    })
  }, [students, search])

  function handleClassroomCreated(classroom: Classroom) {
    setClassrooms((prev) => [...prev, classroom])
    setSelectedClassroomId(classroom.id)
  }

  function refreshStudents() {
    setRefreshToken((token) => token + 1)
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายชื่อนักเรียน</h1>
        </div>
        <SupabaseConfigNotice />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายชื่อนักเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedClassroomId ? `${students.length} คน` : 'เลือกห้องเรียนเพื่อดูรายชื่อนักเรียน'}
          </p>
        </div>

        {classrooms.length > 0 && selectedClassroomId && (
          <div className="flex flex-wrap items-center gap-2">
            <ClassroomSelector
              classrooms={classrooms}
              selectedClassroomId={selectedClassroomId}
              onSelect={setSelectedClassroomId}
              onCreated={handleClassroomCreated}
            />
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              Import Students
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              เพิ่มนักเรียน
            </Button>
          </div>
        )}
      </div>

      {classroomsLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลดห้องเรียน...
        </div>
      )}

      {!classroomsLoading && classroomsError && (
        <Card className="border-destructive/30">
          <CardContent className="py-8 text-center text-sm text-destructive">{classroomsError}</CardContent>
        </Card>
      )}

      {!classroomsLoading && !classroomsError && classrooms.length === 0 && (
        <NoClassroomsEmptyState onCreated={handleClassroomCreated} />
      )}

      {!classroomsLoading && !classroomsError && classrooms.length > 0 && selectedClassroomId && (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาด้วยชื่อหรือรหัสนักเรียน"
              className="pl-9"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              {studentsLoading && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  กำลังโหลดรายชื่อนักเรียน...
                </div>
              )}

              {!studentsLoading && studentsError && (
                <div className="py-8 text-center text-sm text-destructive">{studentsError}</div>
              )}

              {!studentsLoading && !studentsError && students.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <Users className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">ยังไม่มีนักเรียนในห้องนี้</p>
                </div>
              )}

              {!studentsLoading && !studentsError && students.length > 0 && filteredStudents.length === 0 && (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  ไม่พบนักเรียนที่ตรงกับคำค้นหา
                </div>
              )}

              {!studentsLoading && !studentsError && filteredStudents.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-5 py-3 font-medium">เลขที่</th>
                        <th className="px-5 py-3 font-medium">รหัสนักเรียน</th>
                        <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                        <th className="px-5 py-3 font-medium">ชื่อเล่น</th>
                        <th className="px-5 py-3 font-medium">ห้อง</th>
                        <th className="px-5 py-3 font-medium">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((student) => (
                        <tr key={student.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-3 text-muted-foreground">{student.number ?? '-'}</td>
                          <td className="px-5 py-3">{student.studentCode ?? '-'}</td>
                          <td className="px-5 py-3 font-medium">
                            {student.firstName} {student.lastName}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">{student.nickname ?? '-'}</td>
                          <td className="px-5 py-3 text-muted-foreground">
                            {classrooms.find((c) => c.id === selectedClassroomId)?.name ?? '-'}
                          </td>
                          <td className="px-5 py-3">
                            <Badge variant={statusVariant[student.status]}>{statusLabel[student.status]}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <AddStudentDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            classrooms={classrooms}
            defaultClassroomId={selectedClassroomId}
            onCreated={refreshStudents}
          />
          <StudentImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            classroomId={selectedClassroomId}
            onImported={refreshStudents}
          />
        </>
      )}
    </div>
  )
}
