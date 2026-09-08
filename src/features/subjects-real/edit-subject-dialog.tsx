import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import {
  getSubjectClassroomsWithCounts,
  hasSubjectClassroomAttendance,
  linkClassroomToSubject,
  unlinkClassroomFromSubject,
  updateSubject,
} from '@/services/subject-service'
import type { Subject } from '@/types/subject'

interface EditSubjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: Subject
  onSaved: () => void
}

interface ClassroomRow {
  classroomId: string
  classroomName: string
  studentCount: number
}

interface PendingRemoval {
  toAdd: string[]
  toRemove: string[]
  /** Names of classrooms in toRemove that already have subject-scoped
   * attendance recorded — shown in the confirmation before proceeding. */
  flaggedNames: string[]
}

/**
 * Edits a subject's own fields AND its classroom links in one dialog —
 * "keep multiple classroom selection... link another classroom, unlink a
 * classroom, see student count per classroom." Unlinking never actually
 * deletes attendance data (see hasSubjectClassroomAttendance's comment in
 * subject-service.ts), so this isn't a hard block, just a confirmation:
 * if any classroom being unlinked already has attendance recorded for
 * this subject, the teacher is warned before losing the ability to take
 * attendance for it under this subject again.
 *
 * Future safeguard note (assignments/grades): once real assignments are
 * classroom-scoped (see the design note in
 * subjects-real/tabs/attendance-tab.tsx's workspace usage and
 * subject-classroom-workspace-page-real.tsx), unlinking a classroom that
 * has assignment submissions or grades recorded for it should get the
 * exact same confirm-before-unlink treatment as attendance does here —
 * add a matching hasSubjectClassroomAssignments-style check to
 * checkRemovalSafety below rather than introducing a second, separate
 * safeguard mechanism.
 */
export function EditSubjectDialog({ open, onOpenChange, subject, onSaved }: EditSubjectDialogProps) {
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [academicYear, setAcademicYear] = useState('')
  const [semester, setSemester] = useState('')
  const [description, setDescription] = useState('')

  const [rows, setRows] = useState<ClassroomRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [originalLinkedIds, setOriginalLinkedIds] = useState<Set<string>>(new Set())
  const [rowsLoading, setRowsLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)

  useEffect(() => {
    if (!open) return
    setName(subject.name)
    setCode(subject.subjectCode ?? '')
    setAcademicYear(subject.academicYear ?? '')
    setSemester(subject.semester ?? '')
    setDescription(subject.description ?? '')
    setError(null)
    setPendingRemoval(null)

    let active = true
    setRowsLoading(true)
    Promise.all([getClassrooms(), getSubjectClassroomsWithCounts(subject.id)])
      .then(async ([allClassrooms, linkedRows]) => {
        if (!active) return
        const counts = await Promise.all(allClassrooms.map((c) => getStudentsByClassroom(c.id)))
        if (!active) return
        setRows(
          allClassrooms.map((c, i) => ({ classroomId: c.id, classroomName: c.name, studentCount: counts[i].length })),
        )
        const linkedIds = new Set(linkedRows.map((l) => l.classroomId))
        setSelectedIds(new Set(linkedIds))
        setOriginalLinkedIds(new Set(linkedIds))
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setRowsLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, subject])

  function toggleClassroom(classroomId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(classroomId)) next.delete(classroomId)
      else next.add(classroomId)
      return next
    })
  }

  async function applyChanges(toAdd: string[], toRemove: string[]) {
    for (const classroomId of toAdd) {
      await linkClassroomToSubject(subject.id, classroomId)
    }
    for (const classroomId of toRemove) {
      await unlinkClassroomFromSubject(subject.id, classroomId)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('กรุณากรอกชื่อรายวิชา')
      return
    }
    if (selectedIds.size === 0) {
      setError('กรุณาเลือกอย่างน้อย 1 ห้องเรียน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await updateSubject(subject.id, {
        name: name.trim(),
        subjectCode: code.trim() || null,
        academicYear: academicYear.trim() || null,
        semester: semester.trim() || null,
        description: description.trim() || null,
      })

      const toAdd = [...selectedIds].filter((id) => !originalLinkedIds.has(id))
      const toRemove = [...originalLinkedIds].filter((id) => !selectedIds.has(id))

      if (toRemove.length > 0) {
        const flags = await Promise.all(toRemove.map((id) => hasSubjectClassroomAttendance(subject.id, id)))
        const flaggedIds = toRemove.filter((_, i) => flags[i])
        if (flaggedIds.length > 0) {
          const flaggedNames = flaggedIds.map(
            (id) => rows.find((r) => r.classroomId === id)?.classroomName ?? id,
          )
          setPendingRemoval({ toAdd, toRemove, flaggedNames })
          setSubmitting(false)
          return
        }
      }

      await applyChanges(toAdd, toRemove)
      toast('บันทึกการแก้ไขรายวิชาแล้ว')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการแก้ไขได้'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmRemoval() {
    if (!pendingRemoval) return
    setSubmitting(true)
    try {
      await applyChanges(pendingRemoval.toAdd, pendingRemoval.toRemove)
      toast('บันทึกการแก้ไขรายวิชาแล้ว')
      setPendingRemoval(null)
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการแก้ไขได้'))
      setPendingRemoval(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขรายวิชา</DialogTitle>
            <DialogDescription>แก้ไขข้อมูลและห้องเรียนที่เชื่อมโยงกับ {subject.name}</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-subject-name">ชื่อรายวิชา *</Label>
                <Input id="edit-subject-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-subject-code">รหัสวิชา</Label>
                <Input id="edit-subject-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-subject-year">ปีการศึกษา</Label>
                <Input id="edit-subject-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-subject-semester">ภาคเรียน</Label>
                <Input id="edit-subject-semester" value={semester} onChange={(e) => setSemester(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-subject-description">รายละเอียด</Label>
              <Textarea
                id="edit-subject-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>ห้องเรียน *</Label>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {rowsLoading ? (
                  <p className="text-sm text-muted-foreground">กำลังโหลดห้องเรียน...</p>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ยังไม่มีห้องเรียน</p>
                ) : (
                  rows.map((row) => (
                    <label key={row.classroomId} className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.classroomId)}
                          onChange={() => toggleClassroom(row.classroomId)}
                          className="size-4 rounded border-input"
                        />
                        {row.classroomName}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.studentCount} คน</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={submitting || rowsLoading}>
                {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {pendingRemoval && (
        <ConfirmDialog
          open={Boolean(pendingRemoval)}
          onOpenChange={(nextOpen) => !nextOpen && setPendingRemoval(null)}
          title="ยกเลิกการเชื่อมโยงห้องเรียน"
          description={`ห้องเรียนต่อไปนี้มีข้อมูลการเช็คชื่อของรายวิชานี้อยู่แล้ว: ${pendingRemoval.flaggedNames.join(
            ', ',
          )}\nข้อมูลจะยังคงอยู่ในระบบ แต่จะไม่สามารถเช็คชื่อห้องนี้ในรายวิชานี้ได้อีก ต้องการดำเนินการต่อหรือไม่?`}
          confirmLabel="ยกเลิกการเชื่อมโยง"
          onConfirm={handleConfirmRemoval}
        />
      )}
    </>
  )
}
