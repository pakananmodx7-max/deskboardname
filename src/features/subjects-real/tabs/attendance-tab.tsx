import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { AttendanceRosterCard } from '@/features/attendance/attendance-roster-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  buildDefaultRecords,
  deriveAttendanceRoster,
  getAttendance,
  parsePeriodNumber,
  saveAttendance,
} from '@/services/attendance-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'
import type { Subject } from '@/types/subject'

interface AttendanceTabProps {
  subject: Subject
  classroomId: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Real, Supabase-backed subject attendance — reuses the exact same
 * AttendanceRosterCard (summary + table + status buttons + notes) as the
 * standalone classroom Attendance page, rather than building a second
 * attendance UI. Which classroom this session is for is now decided one
 * level up, by the subject workspace's own classroom switcher (see
 * subject-classroom-workspace-page-real.tsx) — this tab just receives
 * `classroomId` and never shows another linked classroom's students,
 * plus an optional คาบ (period) number so the same subject+classroom can
 * be checked more than once on the same day (see
 * supabase/migrations/0005_subject_attendance.sql). subject.id is always
 * sent as p_subject_id, so this reads/writes into a subject-scoped
 * session, never the standalone page's homeroom rows.
 */
export function AttendanceTab({ subject, classroomId }: AttendanceTabProps) {
  const { toast } = useToast()

  const [date, setDate] = useState(todayIso)
  const [periodInput, setPeriodInput] = useState('')
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({})
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // periodInput is a free-text field (empty = "no specific period" —
  // exactly the homeroom-style null). Only a positive integer is ever
  // sent to the RPC; anything else is rejected client-side rather than
  // silently sending garbage — see parsePeriodNumber.
  const { value: periodNumber, invalid: periodInvalid } = parsePeriodNumber(periodInput)

  // Reloads the roster + saved attendance whenever the selected classroom,
  // date, or period changes. Real students only, from classroom_students
  // for the selected classroom — never the 38 demo students, and never a
  // stored/duplicated "subject roster" row.
  useEffect(() => {
    if (periodInvalid) return

    let cancelled = false
    setRosterLoading(true)
    setRosterError(null)

    Promise.all([getStudentsByClassroom(classroomId), getAttendance(classroomId, date, subject.id, periodNumber)])
      .then(([classroomStudents, attendance]) => {
        if (cancelled) return
        setStudents(classroomStudents)
        const activeIds = classroomStudents.filter((s) => s.status === 'active').map((s) => s.id)
        setRecords({ ...buildDefaultRecords(activeIds), ...attendance.records })
      })
      .catch((err: unknown) => {
        if (!cancelled) setRosterError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false)
      })

    return () => {
      cancelled = true
    }
    // periodNumber is derived from periodInput/periodInvalid every render;
    // depending on periodInput (+ the guard above) is equivalent and avoids
    // re-deriving inside the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, date, periodInput, subject.id])

  function setStatus(studentId: string, status: AttendanceStatus) {
    setRecords((prev) => ({
      ...prev,
      [studentId]: { studentId, status, note: prev[studentId]?.note ?? null },
    }))
  }

  function setNote(studentId: string, note: string) {
    setRecords((prev) => ({
      ...prev,
      [studentId]: { studentId, status: prev[studentId]?.status ?? 'present', note: note || null },
    }))
  }

  async function handleSave() {
    if (periodInvalid) return
    setSaving(true)
    try {
      const recordsToSave = roster.map((student) => records[student.id] ?? { studentId: student.id, status: 'present', note: null })
      await saveAttendance(classroomId, date, recordsToSave, subject.id, periodNumber)
      toast('บันทึกการเช็คชื่อเรียบร้อยแล้ว')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการเช็คชื่อได้'))
    } finally {
      setSaving(false)
    }
  }

  const roster = deriveAttendanceRoster(students, records)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
            aria-label="วันที่เช็คชื่อ"
          />
          <Input
            type="number"
            min={1}
            step={1}
            value={periodInput}
            onChange={(e) => setPeriodInput(e.target.value)}
            placeholder="คาบ (ถ้ามี)"
            className="w-28"
            aria-label="คาบเรียน"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || rosterLoading || roster.length === 0 || periodInvalid}>
          <Save className="size-4" />
          {saving ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}
        </Button>
      </div>

      {periodInvalid && <p className="text-sm text-destructive">คาบเรียนต้องเป็นจำนวนเต็มบวก</p>}
      {rosterError && <p className="text-sm text-destructive">{rosterError}</p>}

      <AttendanceRosterCard
        roster={roster}
        records={records}
        loading={rosterLoading}
        onSetStatus={setStatus}
        onSetNote={setNote}
      />
    </div>
  )
}
