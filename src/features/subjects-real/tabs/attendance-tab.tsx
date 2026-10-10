import { CalendarDays, Download, RotateCw, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { AttendanceBoard } from '@/features/attendance/attendance-board'
import {
  changedStudentIds,
  countUnchecked,
  decodeRecords,
  mergeLoadedEntries,
  recordsToSave as buildRecordsToSave,
  type BoardEntries,
} from '@/features/attendance/attendance-board-model'
import { UnsavedChangesGuard } from '@/features/attendance/unsaved-changes-guard'
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** คาบ choices; a saved session for a higher period is still offered. */
const PERIOD_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1))

/**
 * Real, Supabase-backed subject attendance (subject → classroom → เช็คชื่อ).
 *
 * Same data path as before: the roster from getStudentsByClassroom, the
 * saved session from getAttendance(classroomId, date, subject.id, period),
 * and writes through the save_attendance_session RPC (saveAttendance),
 * which checks teacher ownership of the classroom and subject. RLS and
 * permissions are unchanged.
 *
 * What changed:
 *   - Students start UNCHECKED (no record), never silently "มา". Only
 *     students the teacher actually marked are saved. Unchanged saved
 *     records are not re-sent, so history is never rewritten.
 *   - Edits stay local until "บันทึกการเช็คชื่อ"; changed cards are
 *     highlighted and leaving with unsaved edits asks first.
 *   - If the saved session fails to load, editing is blocked (with retry):
 *     saving over records the teacher cannot see could overwrite them.
 *   - ลาป่วย is stored as status 'leave' with a "[ลาป่วย]" note prefix
 *     (see attendance-board-model.ts); no schema change.
 *
 * Dashboard analytics read attendance fresh whenever the dashboard is
 * opened (its loaders live in the page, not in a long-lived cache), so a
 * save here shows up there on the next visit.
 */
export function AttendanceTab({ subject, classroomId, classroomName, onDirtyChange }: AttendanceTabProps) {
  const { toast } = useToast()

  const [date, setDate] = useState(todayIso)
  const [periodInput, setPeriodInput] = useState('')
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  /** Saved rows as loaded/saved (keeps archived students who have one). */
  const [savedRecords, setSavedRecords] = useState<Record<string, AttendanceRecord>>({})
  const [baseline, setBaseline] = useState<BoardEntries>({})
  const [entries, setEntries] = useState<BoardEntries>({})
  const [rosterLoading, setRosterLoading] = useState(true)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [exporting, setExporting] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<{ date: string; periodInput: string } | null>(null)
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Synchronous duplicate-submit guard (state updates are async). */
  const savingRef = useRef(false)

  /** Student ids the teacher has edited since the current load started —
   * the delayed saved-session fetch never overwrites them (see
   * mergeLoadedAttendance in attendance-service.ts for the race). */
  const editedIdsRef = useRef<Set<string>>(new Set())

  const { value: periodNumber, invalid: periodInvalid } = parsePeriodNumber(periodInput)

  // The roster fetch and the attendance-session fetch stay two independent
  // requests (not Promise.all): the roster must render even if the
  // session lookup fails (the earlier "0 students" production bug).
  useEffect(() => {
    if (periodInvalid) return

    let cancelled = false
    editedIdsRef.current = new Set()
    setRosterLoading(true)
    setAttendanceLoading(true)
    setRosterError(null)
    setAttendanceError(null)
    setSaveState('idle')
    setSavedRecords({})
    setBaseline({})
    setEntries({})

    getStudentsByClassroom(classroomId)
      .then((classroomStudents) => {
        if (cancelled) return
        setStudents(classroomStudents)
        setRosterLoading(false)

        getAttendance(classroomId, date, subject.id, periodNumber)
          .then((attendance) => {
            if (cancelled) return
            const ids = deriveAttendanceRoster(classroomStudents, attendance.records).map((s) => s.id)
            const loaded = decodeRecords(ids, attendance.records)
            setSavedRecords(attendance.records)
            setBaseline(loaded)
            setEntries((prev) => mergeLoadedEntries(prev, loaded, editedIdsRef.current))
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
  }, [classroomId, date, periodInput, subject.id, reloadToken])

  const roster = useMemo(
    () => deriveAttendanceRoster(students, savedRecords).sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)),
    [students, savedRecords],
  )
  const rosterIds = roster.map((s) => s.id)
  const changedCount = changedStudentIds(rosterIds, entries, baseline).length
  const dirty = changedCount > 0

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function handleBoardChange(next: BoardEntries, touchedIds: string[]) {
    for (const id of touchedIds) editedIdsRef.current.add(id)
    setEntries(next)
    if (saveState !== 'saving') setSaveState('idle')
  }

  /** Date/คาบ changes reload the session — ask first if edits would be lost. */
  function requestSelection(next: { date: string; periodInput: string }) {
    if (dirty) {
      setPendingSelection(next)
      return
    }
    setDate(next.date)
    setPeriodInput(next.periodInput)
  }

  async function handleSave() {
    if (savingRef.current || periodInvalid || attendanceError || rosterLoading || attendanceLoading) return
    const recordsToSave = buildRecordsToSave(rosterIds, entries, baseline)
    if (recordsToSave.length === 0) return
    const snapshot = entries
    const savedIds = recordsToSave.map((r) => r.studentId)
    const uncheckedLeft = countUnchecked(snapshot, rosterIds)

    savingRef.current = true
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
    setSaveState('saving')
    try {
      await saveAttendance(classroomId, date, recordsToSave, subject.id, periodNumber)
      setBaseline((prev) => {
        const next = { ...prev }
        for (const id of savedIds) next[id] = snapshot[id]
        return next
      })
      setSavedRecords((prev) => {
        const next = { ...prev }
        for (const record of recordsToSave) next[record.studentId] = record
        return next
      })
      setSaveState('saved')
      toast(`บันทึกการเช็คชื่อเรียบร้อยแล้ว (${recordsToSave.length} คน)${uncheckedLeft > 0 ? ` · ยังไม่เช็ค ${uncheckedLeft} คน (ไม่ถูกบันทึก)` : ''}`)
      saveStateTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
    } catch (err) {
      // `entries` is deliberately left untouched — every unsaved mark and
      // note stays on screen and can be saved again.
      setSaveState('error')
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการเช็คชื่อได้'))
    } finally {
      savingRef.current = false
    }
  }

  useEffect(() => {
    return () => {
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
    }
  }, [])

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
      <UnsavedChangesGuard when={dirty} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && requestSelection({ date: e.target.value, periodInput })}
              className="w-auto pl-9"
              aria-label="วันที่เช็คชื่อ"
            />
          </div>
          <NativeSelect
            value={periodInput}
            onChange={(e) => requestSelection({ date, periodInput: e.target.value })}
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
          {saveState === 'saved' && <span className="text-sm text-success">บันทึกแล้ว</span>}
          {saveState === 'error' && <span className="text-sm text-destructive">บันทึกไม่สำเร็จ — การแก้ไขยังอยู่ ลองบันทึกอีกครั้ง</span>}
          <Button type="button" variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="size-4" />
            {exporting ? 'กำลังส่งออก...' : 'ส่งออกการเช็คชื่อ (CSV)'}
          </Button>
          <Button onClick={handleSave} disabled={saveState === 'saving' || busy || !dirty || periodInvalid || Boolean(attendanceError)}>
            <Save className="size-4" />
            {saveState === 'saving' ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}
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
        entries={entries}
        baseline={baseline}
        loading={busy}
        lockedReason={attendanceError}
        saving={saveState === 'saving'}
        onChange={handleBoardChange}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSelection(null)
        }}
        title="เปลี่ยนวันที่/คาบโดยไม่บันทึก?"
        description={`มีการเปลี่ยนแปลงที่ยังไม่บันทึก ${changedCount} รายการ หากเปลี่ยนวันที่หรือคาบ การเปลี่ยนแปลงนี้จะหายไป`}
        confirmLabel="เปลี่ยนโดยไม่บันทึก"
        onConfirm={() => {
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
