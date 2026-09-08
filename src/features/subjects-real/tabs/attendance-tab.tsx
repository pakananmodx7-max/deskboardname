import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
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
import { getSubjectClassrooms } from '@/services/subject-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { Subject, SubjectClassroom } from '@/types/subject'
import type { ClassroomStudent } from '@/types/student'

interface AttendanceTabProps {
  subject: Subject
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Real, Supabase-backed subject attendance — reuses the exact same
 * AttendanceRosterCard (summary + table + status buttons + notes) as the
 * standalone classroom Attendance page, rather than building a second
 * attendance UI. What's different here, structurally: a subject can be
 * linked to more than one classroom (subject_classrooms), so the teacher
 * picks WHICH linked classroom this session is for — restricted to
 * getSubjectClassrooms(subject.id), never the teacher's full classroom
 * list — plus an optional คาบ (period) number so the same subject can be
 * checked more than once on the same day (see
 * supabase/migrations/0005_subject_attendance.sql). subject.id is always
 * sent as p_subject_id, so this reads/writes into a subject-scoped
 * session, never the standalone page's homeroom rows.
 */
export function AttendanceTab({ subject }: AttendanceTabProps) {
  const { toast } = useToast()

  const [classrooms, setClassrooms] = useState<SubjectClassroom[]>([])
  const [classroomsLoading, setClassroomsLoading] = useState(true)
  const [classroomsError, setClassroomsError] = useState<string | null>(null)
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null)

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

  useEffect(() => {
    let cancelled = false
    setClassroomsLoading(true)
    setClassroomsError(null)
    getSubjectClassrooms(subject.id)
      .then((rows) => {
        if (cancelled) return
        setClassrooms(rows)
        setSelectedClassroomId((prev) =>
          prev && rows.some((c) => c.classroomId === prev) ? prev : (rows[0]?.classroomId ?? null),
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setClassroomsError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setClassroomsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [subject.id])

  // Reloads the roster + saved attendance whenever the selected linked
  // classroom, date, or period changes. Real students only, from
  // classroom_students for the selected classroom — never the 38 demo
  // students, and never a stored/duplicated "subject roster" row.
  useEffect(() => {
    if (!selectedClassroomId || periodInvalid) {
      if (!selectedClassroomId) {
        setStudents([])
        setRecords({})
      }
      return
    }

    let cancelled = false
    setRosterLoading(true)
    setRosterError(null)

    Promise.all([
      getStudentsByClassroom(selectedClassroomId),
      getAttendance(selectedClassroomId, date, subject.id, periodNumber),
    ])
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
  }, [selectedClassroomId, date, periodInput, subject.id])

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
    if (!selectedClassroomId || periodInvalid) return
    setSaving(true)
    try {
      const recordsToSave = roster.map((student) => records[student.id] ?? { studentId: student.id, status: 'present', note: null })
      await saveAttendance(selectedClassroomId, date, recordsToSave, subject.id, periodNumber)
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
          {classrooms.length > 0 && (
            <NativeSelect
              value={selectedClassroomId ?? ''}
              onChange={(e) => setSelectedClassroomId(e.target.value)}
              className="w-auto min-w-32"
              aria-label="เลือกห้องเรียน"
            >
              {classrooms.map((classroom) => (
                <option key={classroom.id} value={classroom.classroomId}>
                  {classroom.classroomName}
                </option>
              ))}
            </NativeSelect>
          )}
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
      {classroomsError && <p className="text-sm text-destructive">{classroomsError}</p>}
      {rosterError && <p className="text-sm text-destructive">{rosterError}</p>}

      {classroomsLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : classrooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีห้องเรียนที่เชื่อมกับรายวิชานี้</p>
      ) : (
        <AttendanceRosterCard
          roster={roster}
          records={records}
          loading={rosterLoading}
          onSetStatus={setStatus}
          onSetNote={setNote}
        />
      )}
    </div>
  )
}
