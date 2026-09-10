import { Plus, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { useToast } from '@/components/ui/toast'
import { BulkStatusDialog } from '@/features/classroom-management/bulk-status-dialog'
import { EditStudentDialog } from '@/features/classroom-management/edit-student-dialog'
import { MoveClassroomDialog } from '@/features/classroom-management/move-classroom-dialog'
import {
  buildArchiveStudentMessage,
  buildRemoveFromClassroomMessage,
} from '@/features/classroom-management/student-confirm-messages'
import { StudentDetailDrawer } from '@/features/classroom-management/student-detail-drawer'
import { AddStudentDialog } from '@/features/student-management/add-student-dialog'
import { StudentImportDialog } from '@/features/student-import/student-import-dialog'
import { SendNotificationDialog } from '@/features/student-notifications/send-notification-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassrooms } from '@/services/classroom-service'
import {
  archiveStudent,
  getStudentsByClassroom,
  removeStudentFromClassroom,
  updateStudent,
} from '@/services/student-service'
import type { Classroom } from '@/types/classroom'
import type { ClassroomStudent, StudentStatus } from '@/types/student'

interface ClassroomStudentsTabProps {
  classroom: Classroom
}

export function ClassroomStudentsTab({ classroom }: ClassroomStudentsTabProps) {
  const { toast } = useToast()
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [allClassrooms, setAllClassrooms] = useState<Classroom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const [viewingStudent, setViewingStudent] = useState<ClassroomStudent | null>(null)
  const [editingStudent, setEditingStudent] = useState<ClassroomStudent | null>(null)
  const [movingStudent, setMovingStudent] = useState<ClassroomStudent | null>(null)
  const [removingStudent, setRemovingStudent] = useState<ClassroomStudent | null>(null)
  const [archivingStudent, setArchivingStudent] = useState<ClassroomStudent | null>(null)
  const [messagingStudent, setMessagingStudent] = useState<ClassroomStudent | null>(null)
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getStudentsByClassroom(classroom.id)
      .then((rows) => {
        setStudents(rows)
        setSelectedIds((prev) => prev.filter((id) => rows.some((r) => r.id === id)))
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [classroom.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    getClassrooms()
      .then(setAllClassrooms)
      .catch(() => {
        // Move-classroom just won't offer targets if this fails; the rest
        // of the tab still works.
      })
  }, [])

  const allSelected = students.length > 0 && selectedIds.length === students.length

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : students.map((s) => s.id))
  }

  function toggleSelect(studentId: string) {
    setSelectedIds((prev) => (prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]))
  }

  async function handleRemoveFromClassroom(student: ClassroomStudent) {
    try {
      await removeStudentFromClassroom(student.id, classroom.id)
      toast(`นำ ${student.firstName} ${student.lastName} ออกจากห้อง ${classroom.name} แล้ว`)
      setRemovingStudent(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถนำออกจากห้องได้'))
    }
  }

  async function handleArchiveStudent(student: ClassroomStudent) {
    try {
      await archiveStudent(student.id)
      toast(`เปลี่ยนสถานะ ${student.firstName} ${student.lastName} เป็นไม่ได้ใช้งานแล้ว`)
      setArchivingStudent(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบนักเรียนได้'))
    }
  }

  async function handleBulkRemove() {
    const ids = [...selectedIds]
    try {
      await Promise.all(ids.map((id) => removeStudentFromClassroom(id, classroom.id)))
      toast(`นำนักเรียน ${ids.length} คน ออกจากห้อง ${classroom.name} แล้ว`)
      setBulkRemoveOpen(false)
      setSelectedIds([])
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถนำนักเรียนออกจากห้องได้ทั้งหมด'))
    }
  }

  async function handleBulkStatus(status: StudentStatus) {
    const ids = [...selectedIds]
    try {
      await Promise.all(ids.map((id) => updateStudent(id, { status })))
      toast(`เปลี่ยนสถานะนักเรียน ${ids.length} คนแล้ว`)
      setSelectedIds([])
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเปลี่ยนสถานะนักเรียนได้ทั้งหมด'))
    }
  }

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

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">เลือก {selectedIds.length} คน</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setBulkStatusOpen(true)}>
              เปลี่ยนสถานะ
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkRemoveOpen(true)}>
              เอาออกจากห้อง
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-10 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="เลือกทั้งหมด"
                      className="size-4 rounded border-input"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">รหัสนักเรียน</th>
                  <th className="px-5 py-3 font-medium">สถานะ</th>
                  <th className="w-12 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr key={student.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="px-5 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(student.id)}
                          onChange={() => toggleSelect(student.id)}
                          aria-label={`เลือก ${student.firstName} ${student.lastName}`}
                          className="size-4 rounded border-input"
                        />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{student.number ?? '-'}</td>
                      <td className="px-5 py-3 font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{student.studentCode ?? '-'}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {student.status === 'active' ? 'กำลังเรียน' : 'ไม่ได้ใช้งาน'}
                      </td>
                      <td className="px-3 py-2">
                        <RowActionsMenu
                          actions={[
                            { key: 'view', label: 'ดูรายละเอียด', onSelect: () => setViewingStudent(student) },
                            { key: 'edit', label: 'แก้ไขข้อมูล', onSelect: () => setEditingStudent(student) },
                            { key: 'message', label: 'ส่งข้อความ', onSelect: () => setMessagingStudent(student) },
                            {
                              key: 'move',
                              label: 'ย้ายห้อง',
                              onSelect: () => setMovingStudent(student),
                              disabled: allClassrooms.length <= 1,
                            },
                            { key: 'remove', label: 'เอาออกจากห้อง', onSelect: () => setRemovingStudent(student) },
                            {
                              key: 'delete',
                              label: 'ลบนักเรียน',
                              onSelect: () => setArchivingStudent(student),
                              destructive: true,
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
        classroomName={classroom.name}
        onImported={refresh}
      />
      <StudentDetailDrawer
        classroomName={classroom.name}
        student={viewingStudent}
        onOpenChange={(open) => !open && setViewingStudent(null)}
      />

      {messagingStudent && (
        <SendNotificationDialog
          open={Boolean(messagingStudent)}
          onOpenChange={(open) => !open && setMessagingStudent(null)}
          studentId={messagingStudent.id}
          studentName={`${messagingStudent.firstName} ${messagingStudent.lastName}`}
          onSent={() => {
            toast(`ส่งข้อความถึง ${messagingStudent.firstName} ${messagingStudent.lastName} แล้ว`)
            setMessagingStudent(null)
          }}
        />
      )}

      {editingStudent && (
        <EditStudentDialog
          open={Boolean(editingStudent)}
          onOpenChange={(open) => !open && setEditingStudent(null)}
          student={editingStudent}
          onUpdated={() => {
            setEditingStudent(null)
            refresh()
          }}
        />
      )}

      {movingStudent && (
        <MoveClassroomDialog
          open={Boolean(movingStudent)}
          onOpenChange={(open) => !open && setMovingStudent(null)}
          student={movingStudent}
          currentClassroom={classroom}
          classrooms={allClassrooms}
          onMoved={() => {
            const name = `${movingStudent.firstName} ${movingStudent.lastName}`
            setMovingStudent(null)
            toast(`ย้าย ${name} ห้องเรียนแล้ว`)
            refresh()
          }}
        />
      )}

      {removingStudent && (
        <ConfirmDialog
          open={Boolean(removingStudent)}
          onOpenChange={(open) => !open && setRemovingStudent(null)}
          title="เอาออกจากห้องเรียน"
          description={buildRemoveFromClassroomMessage(
            `${removingStudent.firstName} ${removingStudent.lastName}`,
            classroom.name,
          )}
          confirmLabel="เอาออกจากห้อง"
          onConfirm={() => handleRemoveFromClassroom(removingStudent)}
        />
      )}

      {archivingStudent && (
        <ConfirmDialog
          open={Boolean(archivingStudent)}
          onOpenChange={(open) => !open && setArchivingStudent(null)}
          title="ลบนักเรียน"
          description={buildArchiveStudentMessage(`${archivingStudent.firstName} ${archivingStudent.lastName}`)}
          confirmLabel="ลบนักเรียน"
          destructive
          onConfirm={() => handleArchiveStudent(archivingStudent)}
        />
      )}

      <ConfirmDialog
        open={bulkRemoveOpen}
        onOpenChange={setBulkRemoveOpen}
        title="เอาออกจากห้องเรียน"
        description={`นำนักเรียนที่เลือก ${selectedIds.length} คน ออกจากห้อง ${classroom.name}?\nข้อมูลนักเรียนจะยังคงอยู่ในระบบ`}
        confirmLabel="เอาออกจากห้อง"
        onConfirm={handleBulkRemove}
      />

      <BulkStatusDialog
        open={bulkStatusOpen}
        onOpenChange={setBulkStatusOpen}
        count={selectedIds.length}
        onConfirm={handleBulkStatus}
      />
    </div>
  )
}
