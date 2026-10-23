import { CalendarDays, Download, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { AttendanceBoard } from '@/features/attendance/attendance-board'
import { decodeRecords, type BoardEntries } from '@/features/attendance/attendance-board-model'
import { UnsavedChangesGuard } from '@/features/attendance/unsaved-changes-guard'
import { useAttendanceAutoSave } from '@/features/attendance/use-attendance-autosave'
import { buildClassroomAttendanceExportTable } from '@/features/subjects-real/classroom-export-builders'
import { downloadCsv } from '@/lib/export/csv-export'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { deriveAttendanceRoster, getAllAttendanceForClassroom, getAttendance, parsePeriodNumber, saveAttendance } from '@/services/attendance-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { AttendanceRecord } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'
import type { Subject } from '@/types/subject'

interface AttendanceTabProps {
  subject: Subject
  classroomId: string
  classroomName: string
  /** Tells the workspace whether there are unsaved edits, so switching
   * subject tabs can ask first. */
  onDirtyChange?: (dirty: boolean) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** คาบ choices; a saved session for a higher period is still offered. */
const PERIOD_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1))

const UNSAVED_AUTOSAVE_MESSAGE = 'การเช็คชื่อบางรายการยังบันทึกไม่เสร็จหรือบันทึกไม่สำเร็จ หากออกจากหน้านี้ตอนนี้ รายการเหล่านั้นอาจไม่ถูกบันทึก'

/**
 * Real, Supabase-backed subject attendance (subject → classroom → เช็คชื่อ).
 *
 * Same data path as before: the roster from getStudentsByClassroom, the
 * saved session from getAttendance(classroomId, date, subject.id, period),
 * and writes through the save_attendance_session RPC (saveAttendance),
 * which checks teacher ownership of the classroom and subject. RLS and
 * permissions are unchanged; no migration.
 *
 * Auto-save (useAttendanceAutoSave / attendance-autosave.ts): every
 * status, note or bulk change is shown at once and saved automatically —
 * batched, one request at a time, latest click wins, failures kept on
 * screen with a retry. There is no save button.
 *   - Students start UNCHECKED (no record); only marked students are
 *     saved, and only changed ones are sent, so history is never rewritten.
 *   - Changing date/คาบ first finishes pending saves; if a save failed the
 *     teacher is asked before anything is dropped. Leaving the page or a
 *     PWA update with unsaved writes asks first (UnsavedChangesGuard).
 *   - If the saved session fails to load, editing is blocked (with retry):
 *     saving over records the teacher cannot see could overwrite them.
 *   - ลาป่วย is stored as status 'leave' with a "[ลาป่วย]" note prefix
 *     (see attendance-board-model.ts); no schema change.
 */
export function AttendanceTab({ subject, classroomId, classroomName, onDirtyChange }: AttendanceTabProps) {
  const { toast } = useToast()

  const [date, setDate] = useState(todayIso)
  const [periodInput, setPeriodInput] = useState('')
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  /** Saved rows as loaded/saved (keeps archived students who have one). */
  const [savedRecords, setSavedRecords] = useState<Record<string, AttendanceRecord>>({})
  const [rosterLoading, setRosterLoading] = useState(true)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [exporting, setExporting] = useState(false)
  /** A date/คาบ change waiting on a failed save: ask before dropping it. */
  const [pendingSelection, setPendingSelection] = useState<{ date: string; periodInput: string } | null>(null)
  const [switching, setSwitching] = useState(false)

  const { value: periodNumber, invalid: periodInvalid } = parsePeriodNumber(periodInput)
  const sessionKey = `${classroomId}|${subject.id}|${date}|${periodNumber ?? ''}`

  const autosave = useAttendanceAutoSave(
    sessionKey,
    (records) => saveAttendance(classroomId, date, records, subject.id, periodNumber).then(() => undefined),
    {
      onSaved: (records) => {
        setSavedRecords((prev) => {
          const next = { ...prev }
          for (const record of records) next[record.studentId] = record
          return next
        })
      },
      errorMessage: (err) => toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการเช็คชื่อได้'),
    },
  )
  const { reset: resetAutosave } = autosave

  // The roster fetch and the attendance-session fetch stay two independent
  // requests (not Promise.all): the roster must render even if the
  // session lookup fails (the earlier "0 students" production bug).
  useEffect(() => {
    if (periodInvalid) return

    let cancelled = false
    setRosterLoading(true)
    setAttendanceLoading(true)
    setRosterError(null)
    setAttendanceError(null)
    setSavedRecords({})

    getStudentsByClassroom(classroomId)
      .then((classroomStudents) => {
        if (cancelled) return
        setStudents(classroomStudents)
        setRosterLoading(false)

        getAttendance(classroomId, date, subject.id, periodNumber)
          .then((attendance) => {
            if (cancelled) return
            const ids = deriveAttendanceRoster(classroomStudents, attendance.records).map((s) => s.id)
            setSavedRecords(attendance.records)
            // Editing is disabled while loading, so nothing local is lost here.
            resetAutosave(ids, decodeRecords(ids, attendance.records))
            setAttendanceLoading(false)
          })
          .catch((err: unknown) => {
            if (cancelled) return
            setAttendanceError(
              `${toFriendlyErrorMessage(err, 'ไม่สามารถโหลดการเช็คชื่อที่บันทึกไว้ได้')} — ปิดการแก้ไขไว้ก่อน เพื่อไม่ให้บันทึกทับข้อมูลเดิมที่มองไม่เห็น`,
            )
            setAttendanceLoading(false)
          })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRosterError(toFriendlyErrorMessage(err))
          setRosterLoading(false)
          setAttendanceLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // periodNumber is derived from periodInput every render; depending on
    // periodInput (+ the guard above) is equivalent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, date, periodInput, subject.id, reloadToken, resetAutosave])

  const roster = useMemo(
    () => deriveAttendanceRoster(students, savedRecords).sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)),
    [students, savedRecords],
  )
  const dirty = autosave.hasUnsaved

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function handleBoardChange(next: BoardEntries) {
    autosave.update(next)
  }

  /** Date/คาบ changes load another session: finish saving this one first. */
  async function requestSelection(next: { date: string; periodInput: string }) {
    if (!autosave.hasUnsaved) {
      setDate(next.date)
      setPeriodInput(next.periodInput)
      return
    }
    setSwitching(true)
    const saved = await autosave.flushNow()
    setSwitching(false)
    if (saved) {
      setDate(next.date)
      setPeriodInput(next.periodInput)
    } else {
      setPendingSelection(next)
    }
  }

  /**
   * Exports EVERY saved attendance record for this subject+classroom
   * across every date/คาบ (getAllAttendanceForClassroom scoped to
   * subject.id) — saved data only, never unsaved on-screen edits.
   */
  async function handleExport() {
    setExporting(true)
    try {
      const { sessions, records: allRecords } = await getAllAttendanceForClassroom(classroomId, subject.id)
      const table = buildClassroomAttendanceExportTable(subject.name, classroomName, sessions, allRecords, students)
      downloadCsv(table, `เช็คชื่อ-${subject.name}-${classroomName}`)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถส่งออกข้อมูลการเช็คชื่อได้'))
    } finally {
      setExporting(false)
    }
  }

  const periodOptions = periodInput && !PERIOD_OPTIONS.includes(periodInput) ? [...PERIOD_OPTIONS, periodInput] : PERIOD_OPTIONS
  const busy = rosterLoading || attendanceLoading

  return (
    <div className="space-y-4">
      <UnsavedChangesGuard when={dirty} description={UNSAVED_AUTOSAVE_MESSAGE} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && void requestSelection({ date: e.target.value, periodInput })}
              disabled={switching}
              className="w-auto pl-9"
              aria-label="วันที่เช็คชื่อ"
            />
          </div>
          <NativeSelect
            value={periodInput}
            onChange={(e) => void requestSelection({ date, periodInput: e.target.value })}
            disabled={switching}
            className="w-auto min-w-36"
            aria-label="คาบเรียน"
          >
            <option value="">คาบ (ไม่ระบุ)</option>
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                คาบที่ {p}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="size-4" />
            {exporting ? 'กำลังส่งออก...' : 'ส่งออกการเช็คชื่อ (CSV)'}
          </Button>
        </div>
      </div>

      {periodInvalid && <p className="text-sm text-destructive">คาบเรียนต้องเป็นจำนวนเต็มบวก</p>}
      {rosterError && <p className="text-sm text-destructive">{rosterError}</p>}
      {attendanceError && (
        <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((t) => t + 1)}>
          <RotateCw className="size-4" />
          ลองโหลดการเช็คชื่ออีกครั้ง
        </Button>
      )}

      <AttendanceBoard
        students={roster}
        entries={autosave.desired}
        baseline={autosave.confirmed}
        loading={busy}
        lockedReason={attendanceError}
        saveStatus={autosave.status}
        failedIds={autosave.failedIds}
        saveError={autosave.error}
        onRetry={autosave.retry}
        onChange={handleBoardChange}
      />

      <ConfirmDialog
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSelection(null)
        }}
        title="การเช็คชื่อบันทึกไม่สำเร็จ"
        description={`มีการเช็คชื่อ ${autosave.pendingIds.size} รายการที่ยังบันทึกไม่สำเร็จ${autosave.error ? ` (${autosave.error})` : ''}\nกด "ยกเลิก" แล้ว "ลองอีกครั้ง" เพื่อบันทึก หรือเปลี่ยนวันที่/คาบโดยไม่บันทึกรายการเหล่านี้`}
        confirmLabel="เปลี่ยนโดยไม่บันทึก"
        destructive
        onConfirm={() => {
          autosave.discard()
          if (pendingSelection) {
            setDate(pendingSelection.date)
            setPeriodInput(pendingSelection.periodInput)
          }
          setPendingSelection(null)
        }}
      />
    </div>
  )
}
