import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoClassroomInfo, DemoStudent } from '@/demo/types'
import { BulkStatusDialog } from '@/features/classroom-management/bulk-status-dialog'
import { buildArchiveStudentMessage, buildRemoveFromClassroomMessage } from '@/features/classroom-management/student-confirm-messages'
import { EditStudentDialog } from '@/features/classroom-management-demo/edit-student-dialog'
import { MoveClassroomDialog } from '@/features/classroom-management-demo/move-classroom-dialog'
import { StudentDetailDrawer } from '@/features/classroom-management-demo/student-detail-drawer'

interface ClassroomStudentsTabProps {
  classroom: DemoClassroomInfo
  students: DemoStudent[]
}

/**
 * Demo equivalent of classroom-management/tabs/classroom-students-tab.tsx
 * — same UX (checkboxes, "..." row menu, edit/move/remove/archive
 * dialogs, bulk bar), wired to the demo-context actions added for this
 * feature instead of the real Supabase services.
 */
export function ClassroomStudentsTab({ classroom, students }: ClassroomStudentsTabProps) {
  const { toast } = useToast()
  const {
    classrooms,
    removeStudentFromClassroomDemo,
    archiveStudentDemo,
    bulkRemoveStudentsFromClassroomDemo,
    bulkSetStudentsStatusDemo,
  } = useDemoClassroom()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewingStudent, setViewingStudent] = useState<DemoStudent | null>(null)
  const [editingStudent, setEditingStudent] = useState<DemoStudent | null>(null)
  const [movingStudent, setMovingStudent] = useState<DemoStudent | null>(null)
  const [removingStudent, setRemovingStudent] = useState<DemoStudent | null>(null)
  const [archivingStudent, setArchivingStudent] = useState<DemoStudent | null>(null)
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)

  const allSelected = students.length > 0 && selectedIds.length === students.length

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : students.map((s) => s.id))
  }

  function toggleSelect(studentId: string) {
    setSelectedIds((prev) => (prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]))
  }

  return (
    <div className="space-y-4">
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">เลือก {selectedIds.length} คน</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBulkStatusOpen(true)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              เปลี่ยนสถานะ
            </button>
            <button
              type="button"
              onClick={() => setBulkRemoveOpen(true)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              เอาออกจากห้อง
            </button>
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
                {students.length === 0 ? (
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
                      <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                      <td className="px-5 py-3 font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{student.studentCode}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {student.status === 'active' ? 'กำลังเรียน' : 'ไม่ได้ใช้งาน'}
                      </td>
                      <td className="px-3 py-2">
                        <RowActionsMenu
                          actions={[
                            { key: 'view', label: 'ดูรายละเอียด', onSelect: () => setViewingStudent(student) },
                            { key: 'edit', label: 'แก้ไขข้อมูล', onSelect: () => setEditingStudent(student) },
                            {
                              key: 'move',
                              label: 'ย้ายห้อง',
                              onSelect: () => setMovingStudent(student),
                              disabled: classrooms.length <= 1,
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

      <StudentDetailDrawer
        classroomName={classroom.name}
        student={viewingStudent}
        onOpenChange={(open) => !open && setViewingStudent(null)}
      />

      {editingStudent && (
        <EditStudentDialog
          open={Boolean(editingStudent)}
          onOpenChange={(open) => !open && setEditingStudent(null)}
          student={editingStudent}
          onUpdated={() => {
            toast('บันทึกข้อมูลนักเรียนแล้ว')
            setEditingStudent(null)
          }}
        />
      )}

      {movingStudent && (
        <MoveClassroomDialog
          open={Boolean(movingStudent)}
          onOpenChange={(open) => !open && setMovingStudent(null)}
          student={movingStudent}
          currentClassroom={classroom}
          onMoved={() => {
            toast(`ย้าย ${movingStudent.firstName} ${movingStudent.lastName} ห้องเรียนแล้ว`)
            setMovingStudent(null)
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
          onConfirm={() => {
            removeStudentFromClassroomDemo(removingStudent.id, classroom.id)
            toast(`นำ ${removingStudent.firstName} ${removingStudent.lastName} ออกจากห้อง ${classroom.name} แล้ว`)
            setRemovingStudent(null)
          }}
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
          onConfirm={() => {
            archiveStudentDemo(archivingStudent.id)
            toast(`เปลี่ยนสถานะ ${archivingStudent.firstName} ${archivingStudent.lastName} เป็นไม่ได้ใช้งานแล้ว`)
            setArchivingStudent(null)
          }}
        />
      )}

      <ConfirmDialog
        open={bulkRemoveOpen}
        onOpenChange={setBulkRemoveOpen}
        title="เอาออกจากห้องเรียน"
        description={`นำนักเรียนที่เลือก ${selectedIds.length} คน ออกจากห้อง ${classroom.name}?\nข้อมูลนักเรียนจะยังคงอยู่ในระบบ`}
        confirmLabel="เอาออกจากห้อง"
        onConfirm={() => {
          bulkRemoveStudentsFromClassroomDemo(selectedIds, classroom.id)
          toast(`นำนักเรียน ${selectedIds.length} คน ออกจากห้อง ${classroom.name} แล้ว`)
          setSelectedIds([])
          setBulkRemoveOpen(false)
        }}
      />

      <BulkStatusDialog
        open={bulkStatusOpen}
        onOpenChange={setBulkStatusOpen}
        count={selectedIds.length}
        onConfirm={(status) => {
          bulkSetStudentsStatusDemo(selectedIds, status)
          toast(`เปลี่ยนสถานะนักเรียน ${selectedIds.length} คนแล้ว`)
          setSelectedIds([])
        }}
      />
    </div>
  )
}
