import { Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  ATTENDANCE_STATUS_BUTTON_STYLE,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
  ATTENDANCE_SUMMARY_DOT_STYLE,
} from '@/features/attendance/attendance-status'
import { ClassroomSelector } from '@/features/classroom-management/classroom-selector'
import { NoClassroomsEmptyState } from '@/features/classroom-management/no-classrooms-empty-state'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { buildDefaultRecords, getAttendance, getAttendanceSummary, saveAttendance } from '@/services/attendance-service'
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
 * table layout, same status buttons, same live summary card. It adds a
 * classroom selector and a date picker (real attendance is always scoped
 * to "which classroom, which day", unlike the demo page's single fixed
 * classroom + implicit "today"), plus a compact per-student note field
 * (requirement #8) and load/save against attendance-service.ts.
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

  // The roster shown/saved is every currently-active member of the
  // classroom, PLUS any member who has since been archived (status =
  // 'inactive') but already has a saved record for this exact date — so
  // reopening a past day never silently drops a student's attendance
  // history just because they were archived afterward. An archived
  // student with no record on this date simply never appears (no
  // synthetic "มา" default is invented for them).
  const roster = students.filter((s) => s.status === 'active' || records[s.id] !== undefined)
  const rosterSummary: Record<string, AttendanceRecord> = {}
  for (const student of roster) {
    if (records[student.id]) rosterSummary[student.id] = records[student.id]
  }
  const summary = getAttendanceSummary(rosterSummary)

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
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">สรุปการเข้าเรียน</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {ATTENDANCE_STATUS_ORDER.map((status) => (
                <div key={status} className="flex items-center gap-2">
                  <span className={cn('size-2.5 rounded-full', ATTENDANCE_SUMMARY_DOT_STYLE[status])} />
                  <span className="text-muted-foreground">{ATTENDANCE_STATUS_LABEL[status]}</span>
                  <span className="font-semibold">{summary[status]}</span>
                </div>
              ))}
              <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
                <span className="text-muted-foreground">รวมทั้งหมด</span>
                <span className="font-semibold">{summary.total} คน</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">เลขที่</th>
                      <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                      <th className="px-5 py-3 font-medium">สถานะ</th>
                      <th className="px-5 py-3 font-medium">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosterLoading ? (
                      <tr>
                        <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                          กำลังโหลด...
                        </td>
                      </tr>
                    ) : roster.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                          ยังไม่มีนักเรียนในห้องเรียนนี้
                        </td>
                      </tr>
                    ) : (
                      roster.map((student) => {
                        const current = records[student.id]?.status ?? 'present'
                        return (
                          <tr key={student.id} className="border-b border-border last:border-0">
                            <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                            <td className="px-5 py-3 font-medium">
                              {student.firstName} {student.lastName}
                              {student.nickname && (
                                <span className="ml-1.5 text-xs text-muted-foreground">({student.nickname})</span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                {ATTENDANCE_STATUS_ORDER.map((status) => (
                                  <button
                                    key={status}
                                    type="button"
                                    data-active={current === status}
                                    onClick={() => setStatus(student.id, status)}
                                    className={cn(
                                      'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
                                      ATTENDANCE_STATUS_BUTTON_STYLE[status],
                                    )}
                                  >
                                    {ATTENDANCE_STATUS_LABEL[status]}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <Input
                                value={records[student.id]?.note ?? ''}
                                onChange={(e) => setNote(student.id, e.target.value)}
                                placeholder="เช่น ป่วย, รถติด"
                                className="h-8 w-36 text-xs"
                                aria-label={`หมายเหตุของ ${student.firstName} ${student.lastName}`}
                              />
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
