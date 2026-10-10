import { CalendarDays, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentsForClassrooms } from '@/demo/subject-selectors'
import type { DemoSubject } from '@/demo/types'
import { AttendanceBoard } from '@/features/attendance/attendance-board'
import { changedStudentIds, countUnchecked, decodeRecords, recordsToSave as buildRecordsToSave, type BoardEntries } from '@/features/attendance/attendance-board-model'
import { UnsavedChangesGuard } from '@/features/attendance/unsaved-changes-guard'
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
 * AttendanceBoard and model, backed by the in-memory demo store
 * (subjectAttendance + subjectAttendanceNotes, keyed subject → classroom
 * → date → student, so one linked classroom's roll call never shows under
 * another). Edits are a local overlay until "บันทึกการเช็คชื่อ".
 */
export function AttendanceTab({ subject, classroomId, onDirtyChange }: AttendanceTabProps) {
  const { classrooms, allStudents, subjectAttendance, subjectAttendanceNotes, saveSubjectAttendanceEntries } = useDemoClassroom()
  const { toast } = useToast()
  const [date, setDate] = useState(todayIso)
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  /** Only the students edited since the last save/date change. */
  const [edits, setEdits] = useState<BoardEntries>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const students = useMemo(
    () => getStudentsForClassrooms([classroomId], classrooms, allStudents).sort((a, b) => a.number - b.number),
    [classroomId, classrooms, allStudents],
  )
  const ids = useMemo(() => students.map((s) => s.id), [students])

  const baseline = useMemo(() => {
    const statuses = subjectAttendance[subject.id]?.[classroomId]?.[date] ?? {}
    const notes = subjectAttendanceNotes[subject.id]?.[classroomId]?.[date] ?? {}
    const records: Record<string, AttendanceRecord> = {}
    for (const [studentId, status] of Object.entries(statuses)) records[studentId] = { studentId, status, note: notes[studentId] ?? null }
    return decodeRecords(ids, records)
  }, [subjectAttendance, subjectAttendanceNotes, subject.id, classroomId, date, ids])

  const entries = useMemo(() => ({ ...baseline, ...edits }), [baseline, edits])
  const changedCount = changedStudentIds(ids, entries, baseline).length
  const dirty = changedCount > 0

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function handleBoardChange(next: BoardEntries, touchedIds: string[]) {
    setEdits((prev) => {
      const updated = { ...prev }
      for (const id of touchedIds) updated[id] = next[id]
      return updated
    })
  }

  function requestDate(next: string) {
    if (dirty) {
      setPendingDate(next)
      return
    }
    setDate(next)
    setEdits({})
  }

  function handleSave() {
    if (savingRef.current) return
    const recordsToSave = buildRecordsToSave(ids, entries, baseline)
    if (recordsToSave.length === 0) return
    savingRef.current = true
    setSaving(true)
    try {
      saveSubjectAttendanceEntries(subject.id, classroomId, date, recordsToSave)
      setEdits({})
      const uncheckedLeft = countUnchecked(entries, ids)
      toast(`บันทึกการเช็คชื่อของรายวิชาเรียบร้อยแล้ว (${recordsToSave.length} คน)${uncheckedLeft > 0 ? ` · ยังไม่เช็ค ${uncheckedLeft} คน (ไม่ถูกบันทึก)` : ''}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <UnsavedChangesGuard when={dirty} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="date" value={date} onChange={(e) => e.target.value && requestDate(e.target.value)} className="w-auto pl-9" aria-label="วันที่เช็คชื่อ" />
        </div>
        <Button onClick={handleSave} disabled={saving || !dirty}>
          <Save className="size-4" />
          {saving ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}
        </Button>
      </div>

      <AttendanceBoard
        students={students}
        entries={entries}
        baseline={baseline}
        loading={false}
        saving={saving}
        onChange={handleBoardChange}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={pendingDate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDate(null)
        }}
        title="เปลี่ยนวันที่โดยไม่บันทึก?"
        description={`มีการเปลี่ยนแปลงที่ยังไม่บันทึก ${changedCount} รายการ หากเปลี่ยนวันที่ การเปลี่ยนแปลงนี้จะหายไป`}
        confirmLabel="เปลี่ยนโดยไม่บันทึก"
        onConfirm={() => {
          if (pendingDate) {
            setDate(pendingDate)
            setEdits({})
          }
          setPendingDate(null)
        }}
      />
    </div>
  )
}
