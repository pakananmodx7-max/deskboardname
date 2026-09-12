import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { dataMode } from '@/lib/data-mode'
import { getStudentsByClassroom } from '@/services/student-service'
import { callTeacherAgentTool, scrubPossibleTokens, type AgentToolResponse } from '@/services/teacher-agent-tools-client'
import type { AttendanceStatus } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'

/**
 * TEMPORARY developer-only diagnostic panel for the Teacher Agent Tool
 * Layer (Phase 1) — supabase/functions/teacher-agent-tools. Exercises
 * the deployed Edge Function's 5 READ tools AND its 3 SAFE WRITE tools,
 * using the CURRENT signed-in teacher's own Supabase session
 * (supabase.functions.invoke attaches that session's access token
 * automatically — nothing here ever reads, stores, or asks for a
 * token). Restricted to authenticated teachers by its route placement
 * alone: mounted under /teacher/*, inside the SAME <ProtectedRoute>
 * every other teacher page uses (see router.tsx) — an unauthenticated
 * visitor is redirected to /login and a student-role session is
 * redirected to /student/pending before this component ever renders,
 * identical to every real teacher page.
 *
 * This is NOT linked from the sidebar (see nav-items.ts, whose own test
 * pins the sidebar to an exact 9-item list) and is NOT the future
 * Hermes UI — it exists only to confirm the deployed function behaves
 * correctly against production data before anything real is built on
 * top of it.
 *
 * WRITE TOOLS actually write real production data. Every write here
 * goes through ConfirmDialog (see components/ui/confirm-dialog.tsx),
 * which shows exactly what is about to be written and disables its own
 * buttons while the request is in flight — the same double-submission
 * guard every other destructive/write action in this app already uses.
 * No delete tool is exposed here (none exists in the registry either —
 * see supabase/functions/teacher-agent-tools/registry.ts).
 *
 * The full classroom roster used by get_student_summary's picker and
 * mark_attendance_bulk's per-student status table is loaded via
 * student-service.ts's existing getStudentsByClassroom — a plain,
 * already-RLS-scoped Supabase read the rest of the real app already
 * relies on (e.g. the real attendance page). This is deliberately NOT
 * a new agent tool: none of the 5 read tools return a classroom's full
 * roster (list_classrooms only returns a count; get_missing_submissions
 * and get_classroom_summary only return narrow subsets — students
 * missing one assignment, or students already flagged for attention).
 * Relying on those subsets alone is exactly why get_student_summary's
 * picker could appear empty for a classroom with zero missing
 * submissions and zero students currently flagged for attention, even
 * though the classroom has a full roster — a UI data-wiring gap in
 * this diagnostic page, not an authorization or backend defect.
 */

const ATTENTION_THRESHOLD_FIELDS = [
  { key: 'attendanceThresholdPercent', label: 'เกณฑ์การเข้าเรียน (%) — ค่าเริ่มต้น 80' },
  { key: 'missingAssignmentsThreshold', label: 'เกณฑ์งานค้าง (ชิ้น) — ค่าเริ่มต้น 2' },
  { key: 'scoreThresholdPercent', label: 'เกณฑ์คะแนนเฉลี่ย (%) — ค่าเริ่มต้น 50' },
] as const

const ATTENDANCE_STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'มา' },
  { value: 'late', label: 'สาย' },
  { value: 'leave', label: 'ลา' },
  { value: 'absent', label: 'ขาด' },
]
const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'มา',
  late: 'สาย',
  leave: 'ลา',
  absent: 'ขาด',
}

interface KnownClassroom {
  classroomId: string
  classroomName: string
}
interface KnownSubject {
  subjectId: string
  subjectName: string
}
interface KnownAssignment {
  assignmentId: string
  title: string
}
interface KnownStudent {
  studentId: string
  studentName: string
}

interface ToolRunState {
  status: 'idle' | 'loading' | 'success' | 'error'
  requestArgs: Record<string, unknown> | null
  result: AgentToolResponse | null
}

const IDLE_STATE: ToolRunState = { status: 'idle', requestArgs: null, result: null }

function mergeById<T extends { [key: string]: unknown }>(existing: T[], incoming: T[], idKey: keyof T): T[] {
  const byId = new Map(existing.map((item) => [item[idKey], item]))
  for (const item of incoming) byId.set(item[idKey], item)
  return Array.from(byId.values())
}

/** Same `${first} ${last}` (+ nickname) shape the Edge Function's own
 * studentDisplayName (tools/shared.ts) produces — kept identical so a
 * name picked from the full roster (loaded client-side) reads exactly
 * like one that came back from a tool's own response. */
function studentDisplayName(student: Pick<ClassroomStudent, 'firstName' | 'lastName' | 'nickname'>): string {
  const base = `${student.firstName} ${student.lastName}`
  return student.nickname ? `${base} (${student.nickname})` : base
}

/** A short, uniform status line every card shows — HTTP status plus the
 * ok/error outcome, without ever needing to inspect a raw fetch object. */
function ResultStatusLine({ run }: { run: ToolRunState }) {
  if (run.status === 'idle') return <span className="text-xs text-muted-foreground">ยังไม่ได้เรียกใช้งาน</span>
  if (run.status === 'loading') return <span className="text-xs text-muted-foreground">กำลังเรียก...</span>
  if (!run.result) return null

  if (run.result.ok) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="success">สำเร็จ</Badge>
        <span className="text-xs text-muted-foreground">HTTP {run.result.httpStatus}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Badge variant="destructive">ผิดพลาด</Badge>
      <span className="text-xs text-muted-foreground">
        HTTP {run.result.httpStatus ?? '—'} · {run.result.error.code}
      </span>
    </div>
  )
}

function ResultPanel({ run }: { run: ToolRunState }) {
  if (run.status === 'idle' || run.status === 'loading') return null
  if (!run.result) return null

  return (
    <div className="space-y-2">
      <ResultStatusLine run={run} />
      {run.requestArgs && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">อาร์กิวเมนต์ที่ส่ง (request args)</p>
          <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs">
            {JSON.stringify(run.requestArgs, null, 2)}
          </pre>
        </div>
      )}
      {run.result.ok ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">ข้อมูลที่ได้รับ (data)</p>
          <pre className="mt-1 max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs">
            {JSON.stringify(run.result.data, null, 2)}
          </pre>
        </div>
      ) : (
        <div>
          <p className="text-xs font-medium text-destructive">ข้อความผิดพลาด (ปลอดภัย ไม่มี token/secret ใดๆ)</p>
          <p className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {run.result.error.message}
          </p>
        </div>
      )}
    </div>
  )
}

export function AgentToolsDevPage() {
  const [classrooms, setClassrooms] = useState<KnownClassroom[]>([])
  const [subjects, setSubjects] = useState<KnownSubject[]>([])
  const [assignments, setAssignments] = useState<KnownAssignment[]>([])
  const [students, setStudents] = useState<KnownStudent[]>([])

  // The one classroom's FULL roster currently loaded (see the module
  // doc comment above for why this exists) — shared by get_student_summary's
  // picker fix and mark_attendance_bulk's per-student status table.
  const [roster, setRoster] = useState<ClassroomStudent[]>([])
  const [rosterClassroomId, setRosterClassroomId] = useState('')
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const [listClassroomsRun, setListClassroomsRun] = useState<ToolRunState>(IDLE_STATE)
  const [listClassroomsSubjectId, setListClassroomsSubjectId] = useState('')

  const [listAssignmentsRun, setListAssignmentsRun] = useState<ToolRunState>(IDLE_STATE)
  const [listAssignmentsClassroomId, setListAssignmentsClassroomId] = useState('')
  const [listAssignmentsStatus, setListAssignmentsStatus] = useState<'active' | 'archived' | 'all'>('active')

  const [missingSubmissionsRun, setMissingSubmissionsRun] = useState<ToolRunState>(IDLE_STATE)
  const [missingSubmissionsAssignmentId, setMissingSubmissionsAssignmentId] = useState('')

  const [classroomSummaryRun, setClassroomSummaryRun] = useState<ToolRunState>(IDLE_STATE)
  const [classroomSummaryClassroomId, setClassroomSummaryClassroomId] = useState('')
  const [classroomSummaryThresholds, setClassroomSummaryThresholds] = useState<Record<string, string>>({})

  const [studentSummaryRun, setStudentSummaryRun] = useState<ToolRunState>(IDLE_STATE)
  const [studentSummaryStudentId, setStudentSummaryStudentId] = useState('')
  const [studentSummaryClassroomId, setStudentSummaryClassroomId] = useState('')
  const [studentSummarySubjectId, setStudentSummarySubjectId] = useState('')

  const [caRun, setCaRun] = useState<ToolRunState>(IDLE_STATE)
  const [caClassroomId, setCaClassroomId] = useState('')
  const [caTitle, setCaTitle] = useState('')
  const [caDescription, setCaDescription] = useState('')
  const [caMaxScore, setCaMaxScore] = useState('100')
  const [caDueDate, setCaDueDate] = useState('')
  const [caConfirmOpen, setCaConfirmOpen] = useState(false)

  const [copyRun, setCopyRun] = useState<ToolRunState>(IDLE_STATE)
  const [copySourceAssignmentId, setCopySourceAssignmentId] = useState('')
  const [copyTargetClassroomIds, setCopyTargetClassroomIds] = useState<string[]>([])
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false)

  const [attRun, setAttRun] = useState<ToolRunState>(IDLE_STATE)
  const [attClassroomId, setAttClassroomId] = useState('')
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [attStatuses, setAttStatuses] = useState<Record<string, AttendanceStatus | ''>>({})
  const [attConfirmOpen, setAttConfirmOpen] = useState(false)

  if (dataMode === 'demo') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Teacher Agent Tools — แผงทดสอบ (dev only)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase — แผงนี้ใช้ได้เฉพาะเมื่อเชื่อมต่อ Supabase จริงเท่านั้น
          </p>
        </CardContent>
      </Card>
    )
  }

  /**
   * Loads a classroom's FULL roster directly via student-service.ts's
   * getStudentsByClassroom (plain RLS-scoped Supabase read — the exact
   * same call the real attendance page already makes; NOT a new agent
   * tool, NOT a schema/RLS change). Feeds both the shared `students`
   * picker (fixing get_student_summary's previously-empty dropdown) and
   * `roster` (mark_attendance_bulk's per-student status table).
   */
  async function loadRoster(classroomId: string) {
    if (!classroomId) return
    setRosterLoading(true)
    setRosterError(null)
    try {
      const rows = await getStudentsByClassroom(classroomId)
      setRoster(rows)
      setRosterClassroomId(classroomId)
      setAttStatuses({})
      setStudents(mergeById(students, rows.map((r) => ({ studentId: r.id, studentName: studentDisplayName(r) })), 'studentId'))
    } catch (err) {
      setRosterError(scrubPossibleTokens(err instanceof Error ? err.message : 'ไม่สามารถโหลดรายชื่อนักเรียนได้'))
    } finally {
      setRosterLoading(false)
    }
  }

  async function runListClassrooms() {
    const args = listClassroomsSubjectId ? { subjectId: listClassroomsSubjectId } : {}
    setListClassroomsRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool<{
      classrooms: {
        classroomId: string
        classroomName: string
        subjects: { subjectId: string; subjectName: string }[]
      }[]
    }>('list_classrooms', args)
    setListClassroomsRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    if (result.ok) {
      setClassrooms(
        mergeById(
          classrooms,
          result.data.classrooms.map((c) => ({ classroomId: c.classroomId, classroomName: c.classroomName })),
          'classroomId',
        ),
      )
      const discoveredSubjects = result.data.classrooms.flatMap((c) => c.subjects)
      setSubjects(mergeById(subjects, discoveredSubjects, 'subjectId'))
    }
  }

  async function runListAssignments() {
    if (!listAssignmentsClassroomId) return
    const args = { classroomId: listAssignmentsClassroomId, status: listAssignmentsStatus }
    setListAssignmentsRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool<{ assignments: { assignmentId: string; title: string }[] }>(
      'list_assignments',
      args,
    )
    setListAssignmentsRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    if (result.ok) {
      setAssignments(mergeById(assignments, result.data.assignments, 'assignmentId'))
    }
  }

  async function runGetMissingSubmissions() {
    if (!missingSubmissionsAssignmentId) return
    const args = { assignmentId: missingSubmissionsAssignmentId }
    setMissingSubmissionsRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool<{ students: { studentId: string; studentName: string }[] }>(
      'get_missing_submissions',
      args,
    )
    setMissingSubmissionsRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    if (result.ok) {
      setStudents(mergeById(students, result.data.students, 'studentId'))
    }
  }

  async function runGetClassroomSummary() {
    if (!classroomSummaryClassroomId) return
    const args: Record<string, unknown> = { classroomId: classroomSummaryClassroomId }
    for (const field of ATTENTION_THRESHOLD_FIELDS) {
      const raw = classroomSummaryThresholds[field.key]
      if (raw !== undefined && raw !== '') args[field.key] = Number(raw)
    }
    setClassroomSummaryRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool<{
      studentsNeedingAttention: { students: { studentId: string; studentName: string }[] }
    }>('get_classroom_summary', args)
    setClassroomSummaryRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    if (result.ok) {
      setStudents(mergeById(students, result.data.studentsNeedingAttention.students, 'studentId'))
    }
  }

  async function runGetStudentSummary() {
    if (!studentSummaryStudentId) return
    const args: Record<string, unknown> = { studentId: studentSummaryStudentId }
    if (studentSummaryClassroomId) args.classroomId = studentSummaryClassroomId
    if (studentSummarySubjectId) args.subjectId = studentSummarySubjectId
    setStudentSummaryRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool('get_student_summary', args)
    setStudentSummaryRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
  }

  const caClassroomName = classrooms.find((c) => c.classroomId === caClassroomId)?.classroomName ?? caClassroomId
  const caConfirmDescription = [
    `ห้องเรียน: ${caClassroomName}`,
    `ชื่องาน: ${caTitle}`,
    caDescription ? `รายละเอียด: ${caDescription}` : 'รายละเอียด: (ไม่มี)',
    `คะแนนเต็ม: ${caMaxScore}`,
    `กำหนดส่ง: ${caDueDate || 'ไม่ระบุ'}`,
    '',
    'จะสร้างงานใหม่นี้จริงในระบบ production — ยืนยันหรือไม่?',
  ].join('\n')

  async function runCreateAssignment() {
    const args: Record<string, unknown> = {
      classroomId: caClassroomId,
      title: caTitle,
      maxScore: Number(caMaxScore),
    }
    if (caDescription) args.description = caDescription
    if (caDueDate) args.dueDate = caDueDate
    setCaRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool<{ assignmentId: string; title: string }>('create_assignment', args)
    setCaRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    if (result.ok) {
      setAssignments(
        mergeById(assignments, [{ assignmentId: result.data.assignmentId, title: result.data.title }], 'assignmentId'),
      )
    }
    setCaConfirmOpen(false)
  }

  const copySourceTitle =
    assignments.find((a) => a.assignmentId === copySourceAssignmentId)?.title ?? copySourceAssignmentId
  const copyTargetNames = copyTargetClassroomIds.map(
    (id) => classrooms.find((c) => c.classroomId === id)?.classroomName ?? id,
  )
  const copyConfirmDescription = [
    `งานต้นทาง: ${copySourceTitle}`,
    `ห้องเรียนปลายทาง (${copyTargetClassroomIds.length} ห้อง): ${copyTargetNames.join(', ') || '(ยังไม่ได้เลือก)'}`,
    '',
    'จะคัดลอกเฉพาะชื่องาน/รายละเอียด/คะแนนเต็ม/กำหนดส่ง/ไฟล์แนบที่เป็นลิงก์เท่านั้น',
    'จะไม่คัดลอกข้อมูลการส่งงาน คะแนน หรือสถานะของนักเรียนใดๆ ทั้งสิ้น',
    '',
    'จะคัดลอกงานนี้จริงในระบบ production — ยืนยันหรือไม่?',
  ].join('\n')

  function toggleCopyTarget(classroomId: string) {
    setCopyTargetClassroomIds((prev) =>
      prev.includes(classroomId) ? prev.filter((id) => id !== classroomId) : [...prev, classroomId],
    )
  }

  async function runCopyAssignment() {
    const args = { assignmentId: copySourceAssignmentId, targetClassroomIds: copyTargetClassroomIds }
    setCopyRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool<{
      results: { classroomId: string; ok: boolean; assignmentId?: string; error?: string }[]
    }>('copy_assignment_to_classrooms', args)
    setCopyRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    if (result.ok) {
      const created = result.data.results.filter(
        (r): r is { classroomId: string; ok: true; assignmentId: string } => r.ok && Boolean(r.assignmentId),
      )
      setAssignments(
        mergeById(
          assignments,
          created.map((r) => ({ assignmentId: r.assignmentId, title: `(คัดลอกจาก) ${copySourceTitle}` })),
          'assignmentId',
        ),
      )
    }
    setCopyConfirmOpen(false)
  }

  const attClassroomName = classrooms.find((c) => c.classroomId === attClassroomId)?.classroomName ?? attClassroomId
  const attSetEntries = Object.entries(attStatuses).filter(
    (entry): entry is [string, AttendanceStatus] => Boolean(entry[1]),
  )
  const attConfirmDescription = [
    `ห้องเรียน: ${attClassroomName}`,
    `วันที่: ${attDate}`,
    `จำนวนที่จะบันทึก: ${attSetEntries.length} คน (จากทั้งหมด ${roster.length} คนในห้อง)`,
    '',
    ...attSetEntries.map(([studentId, status]) => {
      const student = roster.find((s) => s.id === studentId)
      const name = student ? studentDisplayName(student) : studentId
      return `- ${name}: ${ATTENDANCE_STATUS_LABELS[status]}`
    }),
    '',
    'จะบันทึกการเข้าเรียนนี้จริงในระบบ production — ยืนยันหรือไม่?',
  ].join('\n')

  async function runMarkAttendance() {
    const updates = attSetEntries.map(([studentId, status]) => ({ studentId, status }))
    const args = { classroomId: attClassroomId, date: attDate, updates }
    setAttRun({ status: 'loading', requestArgs: args, result: null })
    const result = await callTeacherAgentTool('mark_attendance_bulk', args)
    setAttRun({ status: result.ok ? 'success' : 'error', requestArgs: args, result })
    setAttConfirmOpen(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Teacher Agent Tools — แผงทดสอบ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          เครื่องมือชั่วคราวสำหรับนักพัฒนา ใช้ทดสอบ Edge Function <code>teacher-agent-tools</code> ที่ deploy ไว้จริง
          ด้วยเซสชันครูที่ล็อกอินอยู่ในขณะนี้ — ยังไม่ใช่หน้าตาสุดท้ายของ Hermes
        </p>
        <p className="mt-1 text-sm font-medium text-destructive">
          ข้อ 6-8 เป็น WRITE TOOLS ที่เขียนข้อมูลจริงลงในระบบ production ทุกครั้งจะมีกล่องยืนยันแสดงรายละเอียดก่อนเสมอ
        </p>
      </div>

      {/* 1. list_classrooms */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. list_classrooms</CardTitle>
          <CardDescription>รายการห้องเรียนของครู พร้อมรายวิชาที่เชื่อมและจำนวนนักเรียน</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>รายวิชา (ไม่บังคับ)</Label>
              <NativeSelect
                value={listClassroomsSubjectId}
                onChange={(e) => setListClassroomsSubjectId(e.target.value)}
              >
                <option value="">-- ทุกรายวิชา --</option>
                {subjects.map((s) => (
                  <option key={s.subjectId} value={s.subjectId}>
                    {s.subjectName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>หรือระบุ subjectId เอง</Label>
              <Input
                value={listClassroomsSubjectId}
                onChange={(e) => setListClassroomsSubjectId(e.target.value)}
                placeholder="uuid (ไม่บังคับ)"
              />
            </div>
          </div>
          <Button type="button" onClick={runListClassrooms} disabled={listClassroomsRun.status === 'loading'}>
            เรียกใช้งาน
          </Button>
          <ResultPanel run={listClassroomsRun} />
        </CardContent>
      </Card>

      {/* 2. list_assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. list_assignments</CardTitle>
          <CardDescription>รายการงานในห้องเรียนที่เลือก พร้อมจำนวนส่ง/ค้าง/สาย</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>ห้องเรียน (จากผลลัพธ์ข้อ 1)</Label>
              <NativeSelect
                value={listAssignmentsClassroomId}
                onChange={(e) => setListAssignmentsClassroomId(e.target.value)}
              >
                <option value="">-- เลือกห้องเรียน --</option>
                {classrooms.map((c) => (
                  <option key={c.classroomId} value={c.classroomId}>
                    {c.classroomName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>หรือระบุ classroomId เอง</Label>
              <Input
                value={listAssignmentsClassroomId}
                onChange={(e) => setListAssignmentsClassroomId(e.target.value)}
                placeholder="uuid"
              />
            </div>
            <div className="space-y-1">
              <Label>สถานะ</Label>
              <NativeSelect
                value={listAssignmentsStatus}
                onChange={(e) => setListAssignmentsStatus(e.target.value as 'active' | 'archived' | 'all')}
              >
                <option value="active">active</option>
                <option value="archived">archived</option>
                <option value="all">all</option>
              </NativeSelect>
            </div>
          </div>
          <Button
            type="button"
            onClick={runListAssignments}
            disabled={listAssignmentsRun.status === 'loading' || !listAssignmentsClassroomId}
          >
            เรียกใช้งาน
          </Button>
          <ResultPanel run={listAssignmentsRun} />
        </CardContent>
      </Card>

      {/* 3. get_missing_submissions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. get_missing_submissions</CardTitle>
          <CardDescription>รายชื่อนักเรียนที่ยังไม่ส่งงานที่เลือก</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>งาน (จากผลลัพธ์ข้อ 2)</Label>
              <NativeSelect
                value={missingSubmissionsAssignmentId}
                onChange={(e) => setMissingSubmissionsAssignmentId(e.target.value)}
              >
                <option value="">-- เลือกงาน --</option>
                {assignments.map((a) => (
                  <option key={a.assignmentId} value={a.assignmentId}>
                    {a.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>หรือระบุ assignmentId เอง</Label>
              <Input
                value={missingSubmissionsAssignmentId}
                onChange={(e) => setMissingSubmissionsAssignmentId(e.target.value)}
                placeholder="uuid"
              />
            </div>
          </div>
          <Button
            type="button"
            onClick={runGetMissingSubmissions}
            disabled={missingSubmissionsRun.status === 'loading' || !missingSubmissionsAssignmentId}
          >
            เรียกใช้งาน
          </Button>
          <ResultPanel run={missingSubmissionsRun} />
        </CardContent>
      </Card>

      {/* 4. get_classroom_summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">4. get_classroom_summary</CardTitle>
          <CardDescription>สรุปภาพรวมห้องเรียน — การเข้าเรียน งาน คะแนน และนักเรียนที่ควรดูแลเป็นพิเศษ</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>ห้องเรียน (จากผลลัพธ์ข้อ 1)</Label>
              <NativeSelect
                value={classroomSummaryClassroomId}
                onChange={(e) => setClassroomSummaryClassroomId(e.target.value)}
              >
                <option value="">-- เลือกห้องเรียน --</option>
                {classrooms.map((c) => (
                  <option key={c.classroomId} value={c.classroomId}>
                    {c.classroomName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>หรือระบุ classroomId เอง</Label>
              <Input
                value={classroomSummaryClassroomId}
                onChange={(e) => setClassroomSummaryClassroomId(e.target.value)}
                placeholder="uuid"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {ATTENTION_THRESHOLD_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label>{field.label}</Label>
                <Input
                  type="number"
                  value={classroomSummaryThresholds[field.key] ?? ''}
                  onChange={(e) =>
                    setClassroomSummaryThresholds((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder="ค่าเริ่มต้น"
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            onClick={runGetClassroomSummary}
            disabled={classroomSummaryRun.status === 'loading' || !classroomSummaryClassroomId}
          >
            เรียกใช้งาน
          </Button>
          <ResultPanel run={classroomSummaryRun} />
        </CardContent>
      </Card>

      {/* 5. get_student_summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">5. get_student_summary</CardTitle>
          <CardDescription>
            สรุปรายบุคคล — รายชื่อนักเรียนเริ่มจากผลลัพธ์ข้อ 3/4 เท่านั้น ถ้าห้องนี้ยังไม่มีใครค้างงานหรือถูกตั้งค่าให้
            ต้องดูแลเป็นพิเศษ รายชื่อจะยังว่าง ให้เลือกห้องเรียนด้านล่างแล้วกด “โหลดรายชื่อนักเรียนทั้งหมดในห้องนี้”
            (ใช้การอ่านข้อมูลตรงผ่านสิทธิ์ RLS ของครูแบบเดียวกับหน้าเช็คชื่อจริง ไม่ใช่ agent tool)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>ห้องเรียน (ไม่บังคับ — ใช้แยกกรณีนักเรียนอยู่หลายห้อง และใช้โหลดรายชื่อทั้งหมด)</Label>
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  value={studentSummaryClassroomId}
                  onChange={(e) => setStudentSummaryClassroomId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {classrooms.map((c) => (
                    <option key={c.classroomId} value={c.classroomId}>
                      {c.classroomName}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadRoster(studentSummaryClassroomId)}
                  disabled={!studentSummaryClassroomId || rosterLoading}
                >
                  {rosterLoading ? 'กำลังโหลด...' : 'โหลดรายชื่อนักเรียนทั้งหมดในห้องนี้'}
                </Button>
              </div>
              {rosterError && <p className="text-xs text-destructive">{rosterError}</p>}
              {rosterClassroomId && !rosterError && (
                <p className="text-xs text-muted-foreground">
                  โหลดรายชื่อนักเรียนแล้ว {roster.length} คน จากห้อง{' '}
                  {classrooms.find((c) => c.classroomId === rosterClassroomId)?.classroomName ?? rosterClassroomId}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>นักเรียน</Label>
              <NativeSelect
                value={studentSummaryStudentId}
                onChange={(e) => setStudentSummaryStudentId(e.target.value)}
              >
                <option value="">-- เลือกนักเรียน --</option>
                {students.map((s) => (
                  <option key={s.studentId} value={s.studentId}>
                    {s.studentName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>หรือระบุ studentId เอง</Label>
              <Input
                value={studentSummaryStudentId}
                onChange={(e) => setStudentSummaryStudentId(e.target.value)}
                placeholder="uuid"
              />
            </div>
            <div className="space-y-1">
              <Label>รายวิชา (ไม่บังคับ)</Label>
              <NativeSelect
                value={studentSummarySubjectId}
                onChange={(e) => setStudentSummarySubjectId(e.target.value)}
              >
                <option value="">-- ไม่ระบุ --</option>
                {subjects.map((s) => (
                  <option key={s.subjectId} value={s.subjectId}>
                    {s.subjectName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Button
            type="button"
            onClick={runGetStudentSummary}
            disabled={studentSummaryRun.status === 'loading' || !studentSummaryStudentId}
          >
            เรียกใช้งาน
          </Button>
          <ResultPanel run={studentSummaryRun} />
        </CardContent>
      </Card>

      {/* 6. create_assignment (WRITE) */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base">6. create_assignment (WRITE)</CardTitle>
          <CardDescription>สร้างงานใหม่จริงในห้องเรียนที่เลือก — ไม่มีการสร้างข้อมูลการส่งงาน/คะแนนของนักเรียน</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>ห้องเรียน (จากผลลัพธ์ข้อ 1)</Label>
              <NativeSelect value={caClassroomId} onChange={(e) => setCaClassroomId(e.target.value)}>
                <option value="">-- เลือกห้องเรียน --</option>
                {classrooms.map((c) => (
                  <option key={c.classroomId} value={c.classroomId}>
                    {c.classroomName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>หรือระบุ classroomId เอง</Label>
              <Input value={caClassroomId} onChange={(e) => setCaClassroomId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1">
              <Label>ชื่องาน</Label>
              <Input value={caTitle} onChange={(e) => setCaTitle(e.target.value)} placeholder="เช่น ใบงานที่ 1" />
            </div>
            <div className="space-y-1">
              <Label>คะแนนเต็ม</Label>
              <Input type="number" value={caMaxScore} onChange={(e) => setCaMaxScore(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>รายละเอียด (ไม่บังคับ)</Label>
              <Textarea value={caDescription} onChange={(e) => setCaDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>กำหนดส่ง (ไม่บังคับ)</Label>
              <Input type="date" value={caDueDate} onChange={(e) => setCaDueDate(e.target.value)} />
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setCaConfirmOpen(true)}
            disabled={caRun.status === 'loading' || !caClassroomId || !caTitle.trim() || !caMaxScore}
          >
            สร้างงาน (ต้องยืนยันอีกครั้ง)
          </Button>
          <ResultPanel run={caRun} />
          {caRun.status === 'success' && caRun.result?.ok && (
            <p className="text-xs text-muted-foreground">
              สร้างงานสำเร็จ — assignmentId: <code>{(caRun.result.data as { assignmentId: string }).assignmentId}</code>{' '}
              (เพิ่มเข้ารายการงานสำหรับข้อ 3/7 แล้วโดยอัตโนมัติ)
            </p>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={caConfirmOpen}
        onOpenChange={setCaConfirmOpen}
        title="ยืนยันการสร้างงานใหม่ (create_assignment)"
        description={caConfirmDescription}
        confirmLabel="สร้างงาน"
        destructive
        onConfirm={runCreateAssignment}
      />

      {/* 7. copy_assignment_to_classrooms (WRITE) */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base">7. copy_assignment_to_classrooms (WRITE)</CardTitle>
          <CardDescription>
            คัดลอกงานที่เลือกไปยังห้องเรียนปลายทางที่เลือก — ไม่คัดลอกข้อมูลการส่งงาน/คะแนนของนักเรียน (ตรวจสอบได้โดยนำ
            assignmentId ที่ได้ไปรันข้อ 3 แล้วดูว่านักเรียนทุกคนขึ้นเป็น "ยังไม่ส่ง" ทั้งหมด)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>งานต้นทาง (จากผลลัพธ์ข้อ 2/6)</Label>
            <NativeSelect value={copySourceAssignmentId} onChange={(e) => setCopySourceAssignmentId(e.target.value)}>
              <option value="">-- เลือกงาน --</option>
              {assignments.map((a) => (
                <option key={a.assignmentId} value={a.assignmentId}>
                  {a.title}
                </option>
              ))}
            </NativeSelect>
            <Input
              value={copySourceAssignmentId}
              onChange={(e) => setCopySourceAssignmentId(e.target.value)}
              placeholder="หรือระบุ assignmentId เอง (uuid)"
            />
          </div>
          <div className="space-y-1">
            <Label>ห้องเรียนปลายทาง (เลือกได้หลายห้อง)</Label>
            <div className="flex flex-wrap gap-3 rounded-md border border-border p-3">
              {classrooms.length === 0 && (
                <p className="text-xs text-muted-foreground">ยังไม่มีห้องเรียน — กดเรียกใช้งานข้อ 1 ก่อน</p>
              )}
              {classrooms.map((c) => (
                <label key={c.classroomId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={copyTargetClassroomIds.includes(c.classroomId)}
                    onChange={() => toggleCopyTarget(c.classroomId)}
                  />
                  {c.classroomName}
                </label>
              ))}
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setCopyConfirmOpen(true)}
            disabled={copyRun.status === 'loading' || !copySourceAssignmentId || copyTargetClassroomIds.length === 0}
          >
            คัดลอกงาน (ต้องยืนยันอีกครั้ง)
          </Button>
          <ResultPanel run={copyRun} />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={copyConfirmOpen}
        onOpenChange={setCopyConfirmOpen}
        title="ยืนยันการคัดลอกงาน (copy_assignment_to_classrooms)"
        description={copyConfirmDescription}
        confirmLabel="คัดลอกงาน"
        destructive
        onConfirm={runCopyAssignment}
      />

      {/* 8. mark_attendance_bulk (WRITE) */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base">8. mark_attendance_bulk (WRITE)</CardTitle>
          <CardDescription>บันทึกการเข้าเรียนของนักเรียนที่เลือกสถานะไว้เท่านั้น (ไม่ระบุ = ไม่บันทึก)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>ห้องเรียน (จากผลลัพธ์ข้อ 1)</Label>
              <div className="flex gap-2">
                <NativeSelect value={attClassroomId} onChange={(e) => setAttClassroomId(e.target.value)} className="flex-1">
                  <option value="">-- เลือกห้องเรียน --</option>
                  {classrooms.map((c) => (
                    <option key={c.classroomId} value={c.classroomId}>
                      {c.classroomName}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadRoster(attClassroomId)}
                  disabled={!attClassroomId || rosterLoading}
                >
                  {rosterLoading ? 'กำลังโหลด...' : 'โหลดรายชื่อนักเรียน'}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>วันที่</Label>
              <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} />
            </div>
          </div>
          {rosterError && <p className="text-xs text-destructive">{rosterError}</p>}

          {rosterClassroomId === attClassroomId && attClassroomId && roster.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                นักเรียนในห้องนี้ {roster.length} คน — เลือกสถานะเฉพาะคนที่ต้องการบันทึก คนที่ไม่ได้เลือกจะไม่ถูกบันทึก
              </p>
              <div className="max-h-80 overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">เลขที่</th>
                      <th className="px-3 py-2">ชื่อ-นามสกุล</th>
                      <th className="px-3 py-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((student) => (
                      <tr key={student.id} className="border-t border-border">
                        <td className="px-3 py-2">{student.number ?? '—'}</td>
                        <td className="px-3 py-2">{studentDisplayName(student)}</td>
                        <td className="px-3 py-2">
                          <NativeSelect
                            value={attStatuses[student.id] ?? ''}
                            onChange={(e) =>
                              setAttStatuses((prev) => ({
                                ...prev,
                                [student.id]: e.target.value as AttendanceStatus | '',
                              }))
                            }
                          >
                            <option value="">-- ไม่ระบุ --</option>
                            {ATTENDANCE_STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            attClassroomId && <p className="text-xs text-muted-foreground">กด "โหลดรายชื่อนักเรียน" ก่อนบันทึกการเข้าเรียน</p>
          )}

          <Button
            type="button"
            variant="destructive"
            onClick={() => setAttConfirmOpen(true)}
            disabled={attRun.status === 'loading' || !attClassroomId || !attDate || attSetEntries.length === 0}
          >
            บันทึกการเข้าเรียน (ต้องยืนยันอีกครั้ง)
          </Button>
          <ResultPanel run={attRun} />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={attConfirmOpen}
        onOpenChange={setAttConfirmOpen}
        title="ยืนยันการบันทึกการเข้าเรียน (mark_attendance_bulk)"
        description={attConfirmDescription}
        confirmLabel="บันทึกการเข้าเรียน"
        destructive
        onConfirm={runMarkAttendance}
      />
    </div>
  )
}
