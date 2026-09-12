import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { dataMode } from '@/lib/data-mode'
import { callTeacherAgentTool, type AgentToolResponse } from '@/services/teacher-agent-tools-client'

/**
 * TEMPORARY developer-only diagnostic panel for the Teacher Agent Tool
 * Layer (Phase 1) — supabase/functions/teacher-agent-tools. Exercises
 * the deployed Edge Function's 5 READ tools only, using the CURRENT
 * signed-in teacher's own Supabase session (supabase.functions.invoke
 * attaches that session's access token automatically — nothing here
 * ever reads, stores, or asks for a token). Restricted to authenticated
 * teachers by its route placement alone: mounted under /teacher/*,
 * inside the SAME <ProtectedRoute> every other teacher page uses (see
 * router.tsx) — an unauthenticated visitor is redirected to /login and
 * a student-role session is redirected to /student/pending before this
 * component ever renders, identical to every real teacher page.
 *
 * This is NOT linked from the sidebar (see nav-items.ts, whose own test
 * pins the sidebar to an exact 9-item list) and is NOT the future
 * Hermes UI — it exists only to confirm the deployed function behaves
 * correctly against production data before anything real is built on
 * top of it. Write tools (create_assignment, copy_assignment_to_classrooms,
 * mark_attendance_bulk) are deliberately NOT exposed here.
 */

const ATTENTION_THRESHOLD_FIELDS = [
  { key: 'attendanceThresholdPercent', label: 'เกณฑ์การเข้าเรียน (%) — ค่าเริ่มต้น 80' },
  { key: 'missingAssignmentsThreshold', label: 'เกณฑ์งานค้าง (ชิ้น) — ค่าเริ่มต้น 2' },
  { key: 'scoreThresholdPercent', label: 'เกณฑ์คะแนนเฉลี่ย (%) — ค่าเริ่มต้น 50' },
] as const

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Teacher Agent Tools — แผงทดสอบ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          เครื่องมือชั่วคราวสำหรับนักพัฒนา ใช้ทดสอบ Edge Function <code>teacher-agent-tools</code> ที่ deploy ไว้จริง
          ด้วยเซสชันครูที่ล็อกอินอยู่ในขณะนี้ — ยังไม่ใช่หน้าตาสุดท้ายของ Hermes และแสดงเฉพาะ READ TOOLS เท่านั้น
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
            สรุปรายบุคคล — รายชื่อนักเรียนมาจากผลลัพธ์ข้อ 3 (ยังไม่ส่งงาน) และข้อ 4 (ควรดูแลเป็นพิเศษ)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
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
              <Label>ห้องเรียน (ไม่บังคับ — ใช้แยกกรณีนักเรียนอยู่หลายห้อง)</Label>
              <NativeSelect
                value={studentSummaryClassroomId}
                onChange={(e) => setStudentSummaryClassroomId(e.target.value)}
              >
                <option value="">-- ไม่ระบุ --</option>
                {classrooms.map((c) => (
                  <option key={c.classroomId} value={c.classroomId}>
                    {c.classroomName}
                  </option>
                ))}
              </NativeSelect>
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
    </div>
  )
}
