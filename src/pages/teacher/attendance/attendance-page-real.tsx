import { Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { AttendanceRosterCard } from '@/features/attendance/attendance-roster-card'
import { ClassroomSelector } from '@/features/classroom-management/classroom-selector'
import { NoClassroomsEmptyState } from '@/features/classroom-management/no-classrooms-empty-state'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { buildDefaultRecords, deriveAttendanceRoster, getAttendance, saveAttendance } from '@/services/attendance-service'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { Classroom } from '@/types/classroom'
import type { ClassroomStudent } from '@/types/student'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Real, Supabase-backed equivalent of attendance-page-demo.tsx — same
 * table layout, same status buttons, same live summary card (all shared
 * with the subject เช็คชื่อ tab via AttendanceRosterCard). It adds a
 * classroom selector and a date picker (real attendance is always scoped
 * to "which classroom, which day", unlike the demo page's single fixed
 * classroom + implicit "today"), plus a compact per-student note field
 * and load/save against attendance-service.ts. subjectId/periodNumber are
 * left at their defaults (null) everywhere here — this page only ever
 * writes/reads homeroom (classroom-level) sessions.
 */
export function AttendancePageReal() {
  const { toast } = useToast()

  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [classroomsLoading, setClassroomsLoading] = useState(true)
  const [classroomsError, setClassroomsError] = useState<string | null>(null)
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null)

  const [date, setDate] = useState(todayIso)
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({})
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refreshClassrooms = useCallback(() => {
    setClassroomsLoading(true)
    setClassroomsError(null)
    return getClassrooms()
      .then((rows) => {
        setClassrooms(rows)
        setSelectedClassroomId((prev) => (prev && rows.some((c) => c.id === prev) ? prev : (rows[0]?.id ?? null)))
      })
      .catch((err: unknown) => setClassroomsError(toFriendlyErrorMessage(err)))
      .finally(() => setClassroomsLoading(false))
  }, [])

  useEffect(() => {
    refreshClassrooms()
  }, [refreshClassrooms])

  // Reloads the roster + saved attendance whenever the selected classroom
  // or date changes — a fresh classroom_students read (never the 38 demo
  // students) plus getAttendance's real Supabase lookup for that exact
  // classroom+date. Saved statuses win over the "present" default so
  // reopening an already-saved day shows exactly what was recorded.
  useEffect(() => {
    if (!selectedClassroomId) {
      setStudents([])
      setRecords({})
      return
    }

    let cancelled = false
    setRosterLoading(true)
    setRosterError(null)

    Promise.all([getStudentsByClassroom(selectedClassroomId), getAttendance(selectedClassroomId, date)])
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
  }, [selectedClassroomId, date])

  function handleClassroomCreated(classroom: Classroom) {
    setClassrooms((prev) => [...prev, classroom])
    setSelectedClassroomId(classroom.id)
  }

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
    if (!selectedClassroomId) return
    setSaving(true)
    try {
      const recordsToSave = roster.map((student) => records[student.id] ?? { studentId: student.id, status: 'present', note: null })
      await saveAttendance(selectedClassroomId, date, recordsToSave)
      toast('บันทึกการเช็คชื่อเรียบร้อยแล้ว')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการเช็คชื่อได้'))
    } finally {
      setSaving(false)
    }
  }

  const selectedClassroom = classrooms.find((c) => c.id === selectedClassroomId) ?? null
  const roster = deriveAttendanceRoster(students, records)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">เช็คชื่อนักเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {classroomsLoading ? 'กำลังโหลด...' : (selectedClassroom?.name ?? '-')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
            aria-label="วันที่เช็คชื่อ"
          />
          {classrooms.length > 0 && (
            <ClassroomSelector
              classrooms={classrooms}
              selectedClassroomId={selectedClassroomId}
              onSelect={setSelectedClassroomId}
              onCreated={handleClassroomCreated}
            />
          )}
          <Button onClick={handleSave} disabled={saving || rosterLoading || roster.length === 0}>
            <Save className="size-4" />
            {saving ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}
          </Button>
        </div>
      </div>

      {classroomsError && <p className="text-sm text-destructive">{classroomsError}</p>}
      {rosterError && <p className="text-sm text-destructive">{rosterError}</p>}

      {classroomsLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : classrooms.length === 0 ? (
        <NoClassroomsEmptyState onCreated={handleClassroomCreated} />
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
