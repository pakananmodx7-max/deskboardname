import { ArrowLeft, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { RadarChart } from '@/components/charts/radar-chart'
import { TrendLineChart } from '@/components/charts/trend-line-chart'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { exportStudentSummaryPng } from '@/features/student-analytics/student-summary-export'
import {
  buildStudentAnalyticsPath,
  buildSubjectClassroomPath,
  buildSubjectClassroomTabPath,
} from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassroomById } from '@/services/classroom-service'
import {
  createStudentFollowUpNote,
  deleteStudentFollowUpNote,
  filterActiveStudentsForSwitcher,
  getNextStudent,
  getPreviousStudent,
  getStudentAnalyticsSnapshot,
  getStudentFollowUpNotes,
} from '@/services/student-analytics-service'
import { getSubjectById } from '@/services/subject-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Classroom } from '@/types/classroom'
import type { ClassroomStudent } from '@/types/student'
import type { StudentAnalyticsSnapshot, StudentFollowUpNote } from '@/types/student-analytics'
import type { Subject } from '@/types/subject'

/**
 * วิเคราะห์นักเรียน (Student Analytics) — a single student's
 * multi-dimensional overview inside one subject+classroom workspace. See
 * student-analytics-service.ts's doc comment for exactly which
 * dimensions are computed, which are deliberately dropped, and why. This
 * page NEVER reads or writes sgs_score_columns/sgs_scores — the SGS
 * Bridge/Score Calculator is untouched by this feature end to end.
 */
export function StudentAnalyticsPage() {
  const { subjectId, classroomId, studentId } = useParams<{ subjectId: string; classroomId: string; studentId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [subject, setSubject] = useState<Subject | null | undefined>(undefined)
  const [classroom, setClassroom] = useState<Classroom | null | undefined>(undefined)
  const [roster, setRoster] = useState<ClassroomStudent[]>([])
  const [snapshot, setSnapshot] = useState<StudentAnalyticsSnapshot | null>(null)
  /** Which student `snapshot` belongs to — the export is only enabled
   * when it matches the student in the URL, so it can never produce an
   * image of the previously-viewed student. */
  const [snapshotStudentId, setSnapshotStudentId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [notes, setNotes] = useState<StudentFollowUpNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId || !classroomId || !studentId) return
    let active = true
    setLoading(true)
    setError(null)

    Promise.all([
      getSubjectById(subjectId),
      getClassroomById(classroomId),
      getStudentsByClassroom(classroomId),
      getStudentAnalyticsSnapshot(subjectId, classroomId, studentId),
      getStudentFollowUpNotes(studentId, classroomId, subjectId),
    ])
      .then(([subjectRow, classroomRow, rosterRows, snapshotResult, notesResult]) => {
        if (!active) return
        setSubject(subjectRow)
        setClassroom(classroomRow)
        setRoster(rosterRows)
        setSnapshot(snapshotResult)
        setSnapshotStudentId(studentId)
        setNotes(notesResult)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [subjectId, classroomId, studentId])

  if (!subjectId || !classroomId || !studentId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  if (subject === undefined || classroom === undefined || loading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  if (subject === null || classroom === null) {
    return <Navigate to="/teacher/subjects" replace />
  }

  const currentStudent = roster.find((s) => s.id === studentId)

  if (!currentStudent) {
    // Not (or no longer) a member of this classroom's roster at all —
    // never silently renders an analytics page for a student the teacher
    // cannot actually see here.
    return <Navigate to={buildSubjectClassroomPath(subjectId, classroomId)} replace />
  }

  const activeRoster = filterActiveStudentsForSwitcher(roster)
  const previousStudent = getPreviousStudent(activeRoster, studentId)
  const nextStudent = getNextStudent(activeRoster, studentId)

  function goToStudent(nextStudentId: string) {
    navigate(buildStudentAnalyticsPath(subjectId!, classroomId!, nextStudentId))
  }

  /** "ดาวน์โหลดภาพสรุป" — built at click time from exactly what this page
   * is showing (currentStudent, subject, classroom, snapshot); no new
   * analytics query. */
  const canExport = snapshot !== null && snapshotStudentId === studentId && !exporting
  async function handleExportSummary() {
    if (!snapshot || snapshotStudentId !== studentId || !currentStudent || !subject || !classroom) return
    setExporting(true)
    try {
      const filename = await exportStudentSummaryPng({
        student: currentStudent,
        subjectName: subject.name,
        classroom,
        snapshot,
        generatedAt: new Date(),
      })
      toast(`ดาวน์โหลด ${filename} แล้ว`)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'สร้างภาพสรุปไม่สำเร็จ'))
    } finally {
      setExporting(false)
    }
  }

  async function refreshNotes() {
    const rows = await getStudentFollowUpNotes(studentId!, classroomId!, subjectId!)
    setNotes(rows)
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate(buildSubjectClassroomTabPath(subjectId, classroomId, 'students'))}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            กลับไปรายชื่อนักเรียน
          </button>
          <Button size="sm" onClick={() => void handleExportSummary()} disabled={!canExport} aria-label="ดาวน์โหลดภาพสรุปนักเรียนรายบุคคล">
            <Download className="size-3.5" />
            {exporting ? 'กำลังสร้างภาพ...' : 'ดาวน์โหลดภาพสรุป'}
          </Button>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-12 text-base">{currentStudent.firstName.slice(0, 1)}</Avatar>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {currentStudent.firstName} {currentStudent.lastName}
                </h1>
                {currentStudent.status !== 'active' && <Badge variant="outline">ไม่ได้ใช้งาน</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[
                  currentStudent.number !== null ? `เลขที่ ${currentStudent.number}` : null,
                  currentStudent.studentCode ? `รหัส ${currentStudent.studentCode}` : null,
                  subject.name,
                  classroom.name,
                  classroom.academicYear && `ปีการศึกษา ${classroom.academicYear}`,
                  classroom.semester && `ภาคเรียนที่ ${classroom.semester}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={!previousStudent}
              onClick={() => previousStudent && goToStudent(previousStudent.id)}
              aria-label="นักเรียนก่อนหน้า"
            >
              <ChevronLeft className="size-3.5" />
              คนก่อนหน้า
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              นักเรียนในห้องนี้:
              <NativeSelect
                value={studentId}
                onChange={(e) => goToStudent(e.target.value)}
                className="w-auto max-w-[200px]"
                aria-label="นักเรียนในห้องนี้"
                disabled={activeRoster.length === 0}
              >
                {!activeRoster.some((s) => s.id === studentId) && (
                  <option value={studentId}>
                    {currentStudent.firstName} {currentStudent.lastName}
                  </option>
                )}
                {activeRoster.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === studentId ? '✓ ' : ''}
                    {s.number !== null ? `เลขที่ ${s.number} · ` : ''}
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={!nextStudent}
              onClick={() => nextStudent && goToStudent(nextStudent.id)}
              aria-label="นักเรียนถัดไป"
            >
              คนถัดไป
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {snapshot && (
        <StudentAnalyticsBody
          snapshot={snapshot}
          classroomName={classroom.name}
          notes={notes}
          subjectId={subjectId}
          classroomId={classroomId}
          studentId={studentId}
          onNotesChanged={refreshNotes}
          onNoteError={(err) => toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกข้อความได้'))}
        />
      )}
    </div>
  )
}

interface StudentAnalyticsBodyProps {
  snapshot: StudentAnalyticsSnapshot
  classroomName: string
  notes: StudentFollowUpNote[]
  subjectId: string
  classroomId: string
  studentId: string
  onNotesChanged: () => Promise<void>
  onNoteError: (err: unknown) => void
}

function formatMetricValue(value: number | null): string {
  return value === null ? 'ไม่มีข้อมูล' : `${value.toFixed(0)}%`
}

function formatDiff(value: number | null, average: number | null): string {
  if (value === null || average === null) return '-'
  const diff = value - average
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toFixed(0)}%`
}

function StudentAnalyticsBody({
  snapshot,
  classroomName,
  notes,
  subjectId,
  classroomId,
  studentId,
  onNotesChanged,
  onNoteError,
}: StudentAnalyticsBodyProps) {
  const [noteBody, setNoteBody] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  async function handleAddNote() {
    if (!noteBody.trim()) return
    setSavingNote(true)
    try {
      await createStudentFollowUpNote({ studentId, classroomId, subjectId, body: noteBody })
      setNoteBody('')
      await onNotesChanged()
    } catch (err) {
      onNoteError(err)
    } finally {
      setSavingNote(false)
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await deleteStudentFollowUpNote(noteId)
      await onNotesChanged()
    } catch (err) {
      onNoteError(err)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>ภาพรวมหลายมิติ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadarChart
            axes={snapshot.metrics.map((m) => ({ label: m.label, studentValue: m.value, classroomAverage: m.classroomAverage }))}
            studentLabel="นักเรียนคนนี้"
            classroomLabel={`ค่าเฉลี่ยห้อง (${snapshot.classroomSize} คน)`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">มิติ</th>
                  <th className="py-2 pr-3 font-medium">ค่าที่วัดได้</th>
                  <th className="py-2 pr-3 font-medium">ค่าเฉลี่ยห้อง</th>
                  <th className="py-2 font-medium">ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.metrics.map((metric) => (
                  <tr key={metric.key} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      {metric.label}
                      {metric.rawLabel && <span className="ml-1.5 text-xs text-muted-foreground">({metric.rawLabel})</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatMetricValue(metric.value)}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{formatMetricValue(metric.classroomAverage)}</td>
                    <td className="py-2 tabular-nums">{formatDiff(metric.value, metric.classroomAverage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>แนวโน้มผลการเรียน</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendLineChart
            points={snapshot.trend.map((p) => ({ label: p.assignmentTitle, studentValue: p.studentPercent, classroomAverageValue: p.classroomAveragePercent }))}
            studentLabel="นักเรียนคนนี้"
            classroomLabel="ค่าเฉลี่ยห้อง"
          />
          {snapshot.trend.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {snapshot.trend.map((p) => (
                <li key={p.assignmentId} className="flex justify-between gap-2">
                  <span className="truncate">{p.assignmentTitle}</span>
                  <span className="shrink-0 tabular-nums">{p.studentPercent.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>การเข้าเรียน</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.attendance.total === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลการเช็คชื่อสำหรับรายวิชานี้</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">มา</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.attendance.present}</p>
              </div>
              <div>
                <p className="text-muted-foreground">สาย</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.attendance.late}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ลา</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.attendance.leave}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ขาด</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.attendance.absent}</p>
              </div>
              <div className="col-span-2 border-t border-border pt-2 sm:col-span-4">
                <p className="text-muted-foreground">
                  มาเรียน {snapshot.attendance.attendanceRate?.toFixed(0) ?? '-'}% จากทั้งหมด {snapshot.attendance.total} ครั้ง
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>งานที่มอบหมาย</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.assignments.totalAssignments === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีงานในรายวิชานี้</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div>
                <p className="text-muted-foreground">ทั้งหมด</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.assignments.totalAssignments}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ส่งแล้ว</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.assignments.submitted}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ตรงเวลา</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.assignments.onTime}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ส่งช้า</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.assignments.late}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ขาดส่ง</p>
                <p className="text-lg font-semibold tabular-nums">{snapshot.assignments.missing}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>สรุปจากข้อมูลจริง</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่พบประเด็นที่โดดเด่นจากข้อมูลปัจจุบันของ{classroomName}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {snapshot.evidence.map((item, i) => (
                <li key={`${item.kind}-${i}`} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>บันทึกติดตาม</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="บันทึกข้อสังเกตหรือแผนติดตามนักเรียนคนนี้..."
              rows={2}
              className="min-h-[2.5rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button type="button" onClick={handleAddNote} disabled={savingNote || !noteBody.trim()} className="shrink-0">
              บันทึก
            </Button>
          </div>

          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีบันทึกติดตามสำหรับนักเรียนคนนี้</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((note) => (
                <li key={note.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(note.id)}
                      className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                    >
                      ลบ
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleString('th-TH')}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
