import { CalendarDays } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoSubject } from '@/demo/types'
import { AttendanceBoard } from '@/features/attendance/attendance-board'
import { decodeRecords, type BoardEntries } from '@/features/attendance/attendance-board-model'
import { UnsavedChangesGuard } from '@/features/attendance/unsaved-changes-guard'
import { useAttendanceAutoSave } from '@/features/attendance/use-attendance-autosave'
import type { AttendanceRecord } from '@/types/attendance'

interface AttendanceTabProps {
  subject: DemoSubject
  classroomId: string
  onDirtyChange?: (dirty: boolean) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Demo Mode counterpart of subjects-real's AttendanceTab — the same
 * AttendanceBoard, model and auto-save engine, backed by the in-memory
 * demo store (subjectAttendance + subjectAttendanceNotes, keyed subject →
 * classroom → date → student, so one linked classroom's roll call never
 * shows under another). Every change is saved to the store automatically.
 */
export function AttendanceTab({ subject, classroomId, onDirtyChange }: AttendanceTabProps) {
  const { classrooms, allStudents, subjectAttendance, subjectAttendanceNotes, saveSubjectAttendanceEntries } = useDemoClassroom()
  const [date, setDate] = useState(todayIso)
  const [pendingDate, setPendingDate] = useState<string | null>(null)

  const students = useMemo(
    () => getStudentsForClassrooms([classroomId], classrooms, allStudents).sort((a, b) => a.number - b.number),
    [classroomId, classrooms, allStudents],
  )
  const ids = useMemo(() => students.map((s) => s.id), [students])

  const stored = useMemo(() => {
    const statuses = subjectAttendance[subject.id]?.[classroomId]?.[date] ?? {}
    const notes = subjectAttendanceNotes[subject.id]?.[classroomId]?.[date] ?? {}
    const records: Record<string, AttendanceRecord> = {}
    for (const [studentId, status] of Object.entries(statuses)) records[studentId] = { studentId, status, note: notes[studentId] ?? null }
    return decodeRecords(ids, records)
  }, [subjectAttendance, subjectAttendanceNotes, subject.id, classroomId, date, ids])

  const sessionKey = `${subject.id}|${classroomId}|${date}`
  const autosave = useAttendanceAutoSave(sessionKey, async (records) => {
    saveSubjectAttendanceEntries(subject.id, classroomId, date, records)
  })
  const { reset: resetAutosave } = autosave

  // Load the stored roll call once per session (not on every store write,
  // which would drop changes still waiting to be saved).
  useEffect(() => {
    resetAutosave(ids, stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, resetAutosave])

  const dirty = autosave.hasUnsaved

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  async function requestDate(next: string) {
    if (!autosave.hasUnsaved || (await autosave.flushNow())) {
      setDate(next)
      return
    }
    setPendingDate(next)
  }

  return (
    <div className="space-y-4">
      <UnsavedChangesGuard when={dirty} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="date" value={date} onChange={(e) => e.target.value && void requestDate(e.target.value)} className="w-auto pl-9" aria-label="วันที่เช็คชื่อ" />
        </div>
      </div>

      <AttendanceBoard
        students={students}
        entries={autosave.desired}
        baseline={autosave.confirmed}
        loading={false}
        saveStatus={autosave.status}
        failedIds={autosave.failedIds}
        saveError={autosave.error}
        onRetry={autosave.retry}
        onChange={(next: BoardEntries) => autosave.update(next)}
      />

      <ConfirmDialog
        open={pendingDate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDate(null)
        }}
        title="การเช็คชื่อบันทึกไม่สำเร็จ"
        description={`มีการเช็คชื่อ ${autosave.pendingIds.size} รายการที่ยังบันทึกไม่สำเร็จ หากเปลี่ยนวันที่ รายการเหล่านี้จะไม่ถูกบันทึก`}
        confirmLabel="เปลี่ยนโดยไม่บันทึก"
        destructive
        onConfirm={() => {
          autosave.discard()
          if (pendingDate) setDate(pendingDate)
          setPendingDate(null)
        }}
      />
    </div>
  )
}
