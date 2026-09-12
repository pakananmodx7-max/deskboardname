import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./agent-tools-dev-page.tsx', import.meta.url), 'utf-8')
}

function readRouterSource(): string {
  return readFileSync(new URL('../../../app/router.tsx', import.meta.url), 'utf-8')
}

function readNavItemsSource(): string {
  return readFileSync(new URL('../../../components/layout/nav-items.ts', import.meta.url), 'utf-8')
}

function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**'))
    .join('\n')
}

describe('AgentToolsDevPage — exactly the 8 registry tools, all wired, no delete tool', () => {
  const source = readSource()
  const code = stripComments(source)

  it('calls callTeacherAgentTool with exactly the 5 read + 3 write tool names, and no others', () => {
    const calls = [...code.matchAll(/callTeacherAgentTool[^(]*\(\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(new Set(calls)).toEqual(
      new Set([
        'list_classrooms',
        'list_assignments',
        'get_missing_submissions',
        'get_classroom_summary',
        'get_student_summary',
        'create_assignment',
        'copy_assignment_to_classrooms',
        'mark_attendance_bulk',
      ]),
    )
  })

  it('never references a delete tool — none exists in the registry and none is invented here', () => {
    expect(code).not.toMatch(/delete_assignment|delete_subject|delete_lesson|delete_classroom|delete_student/)
  })
})

describe('AgentToolsDevPage — uses the existing authenticated session, never asks for a token', () => {
  const source = readSource()

  it('never renders, logs, or otherwise references an access token / JWT / Authorization header as executable code', () => {
    const code = stripComments(source)
    expect(code).not.toMatch(/access_token|Authorization|jwt/i)
    expect(source).not.toContain('console.log')
  })

  it('imports the client wrapper rather than calling supabase.functions.invoke directly (no duplicated auth/error handling)', () => {
    expect(source).toContain("from '@/services/teacher-agent-tools-client'")
    expect(source).not.toContain('.functions.invoke(')
  })

  it('degrades gracefully (no crash, no Supabase call attempted) when Supabase is not configured', () => {
    expect(source).toContain("dataMode === 'demo'")
  })

  it('scrubs any error message from the roster loader (a non-agent-tool Supabase call) before displaying it, same as the agent tool client', () => {
    const fn = source.slice(source.indexOf('async function loadRoster'), source.indexOf('async function runListClassrooms'))
    expect(fn).toContain('scrubPossibleTokens(')
  })
})

describe('AgentToolsDevPage — write tools require explicit confirmation and show exactly what will be written', () => {
  const source = readSource()

  it('every write tool call site is a handler passed to a <ConfirmDialog>\'s onConfirm — never fired directly from the visible "Run" button', () => {
    for (const handler of ['runCreateAssignment', 'runCopyAssignment', 'runMarkAttendance']) {
      expect(source).toContain(`onConfirm={${handler}}`)
    }
    // the visible buttons only ever open the dialog (setXConfirmOpen(true)), never call the write handler themselves
    expect(source).toContain('onClick={() => setCaConfirmOpen(true)}')
    expect(source).toContain('onClick={() => setCopyConfirmOpen(true)}')
    expect(source).toContain('onClick={() => setAttConfirmOpen(true)}')
  })

  it('create_assignment\'s confirmation names the classroom, title, description, max score, and due date before writing', () => {
    const fn = source.slice(source.indexOf('const caConfirmDescription ='), source.indexOf('async function runCreateAssignment'))
    expect(fn).toContain('ห้องเรียน:')
    expect(fn).toContain('ชื่องาน:')
    expect(fn).toContain('รายละเอียด:')
    expect(fn).toContain('คะแนนเต็ม:')
    expect(fn).toContain('กำหนดส่ง:')
  })

  it('copy_assignment_to_classrooms\' confirmation names the source and every target classroom, and explicitly states submissions/scores are not copied', () => {
    const fn = source.slice(source.indexOf('const copyConfirmDescription ='), source.indexOf('function toggleCopyTarget'))
    expect(fn).toContain('งานต้นทาง:')
    expect(fn).toContain('ห้องเรียนปลายทาง')
    expect(fn).toMatch(/ไม่คัดลอกข้อมูลการส่งงาน/)
  })

  it('mark_attendance_bulk\'s confirmation names the classroom, date, and every student+status about to be written — never a silent bulk write', () => {
    const fn = source.slice(source.indexOf('const attConfirmDescription ='), source.indexOf('async function runMarkAttendance'))
    expect(fn).toContain('ห้องเรียน:')
    expect(fn).toContain('วันที่:')
    expect(fn).toContain('attSetEntries.map')
  })

  it('mark_attendance_bulk only ever sends explicitly-set statuses — students left at "ไม่ระบุ" are excluded from the write, never defaulted', () => {
    expect(source).toContain('attSetEntries.map(([studentId, status]) => ({ studentId, status }))')
    const filterDecl = source.slice(source.indexOf('const attSetEntries ='), source.indexOf('const attConfirmDescription ='))
    expect(filterDecl).toContain('Boolean(entry[1])')
  })
})

describe('AgentToolsDevPage — double-submission prevention on every write', () => {
  const source = readSource()

  it('every write "Run" button is disabled while its own tool call is loading', () => {
    expect(source).toMatch(/onClick=\{\(\) => setCaConfirmOpen\(true\)\}\s*disabled=\{caRun\.status === 'loading'/)
    expect(source).toMatch(/onClick=\{\(\) => setCopyConfirmOpen\(true\)\}\s*disabled=\{copyRun\.status === 'loading'/)
    expect(source).toMatch(/onClick=\{\(\) => setAttConfirmOpen\(true\)\}\s*disabled=\{attRun\.status === 'loading'/)
  })

  it('relies on the shared ConfirmDialog component, which disables its own Cancel/Confirm buttons while the confirm handler is in flight', () => {
    expect(source).toContain("from '@/components/ui/confirm-dialog'")
    expect(source).toContain('<ConfirmDialog')
  })
})

describe('AgentToolsDevPage — copy_assignment_to_classrooms never touches assignment_submissions', () => {
  const source = readSource()

  it('the copy handler itself never references assignment_submissions/scores anywhere', () => {
    const fn = source.slice(source.indexOf('async function runCopyAssignment'), source.indexOf('const attClassroomName ='))
    expect(fn).not.toMatch(/assignment_submissions|score/i)
  })

  it('the copy card documents the verification path (rerun get_missing_submissions on the new id) rather than silently asserting it', () => {
    const card = source.slice(source.indexOf('7. copy_assignment_to_classrooms'), source.indexOf('8. mark_attendance_bulk'))
    expect(card).toMatch(/ไม่คัดลอกข้อมูลการส่งงาน/)
  })
})

describe('AgentToolsDevPage — get_student_summary picker fix: a full roster loader, not only narrow tool subsets', () => {
  const source = readSource()

  it('loadRoster calls the existing, already-RLS-scoped getStudentsByClassroom — never a new agent tool, never the admin/service-role path', () => {
    expect(source).toContain("from '@/services/student-service'")
    expect(source).toContain('getStudentsByClassroom(classroomId)')
    expect(source).not.toMatch(/list_students|get_roster|get_classroom_roster/)
  })

  it('a loaded roster is merged into the SAME `students` list get_student_summary\'s picker reads from', () => {
    const fn = source.slice(source.indexOf('async function loadRoster'), source.indexOf('async function runListClassrooms'))
    expect(fn).toContain('setStudents(mergeById(students,')
  })

  it('card 5 exposes a classroom picker and a load-roster button wired to loadRoster, with the root cause documented for future readers', () => {
    const card = source.slice(source.indexOf('5. get_student_summary'), source.indexOf('6. create_assignment'))
    expect(card).toContain('loadRoster(studentSummaryClassroomId)')
    expect(source).toMatch(/get_student_summary's picker/i)
  })
})

describe('AgentToolsDevPage — selecting IDs from prior results instead of only free-typing UUIDs', () => {
  const source = readSource()

  it('list_classrooms\' successful result seeds the classroom AND subject pickers used by every later tool', () => {
    const fn = source.slice(source.indexOf('async function runListClassrooms'), source.indexOf('async function runListAssignments'))
    expect(fn).toContain('setClassrooms(')
    expect(fn).toContain('setSubjects(')
  })

  it('list_assignments\' successful result seeds the assignment picker used by get_missing_submissions and copy_assignment_to_classrooms', () => {
    const fn = source.slice(source.indexOf('async function runListAssignments'), source.indexOf('async function runGetMissingSubmissions'))
    expect(fn).toContain('setAssignments(')
  })

  it('create_assignment\'s and copy_assignment_to_classrooms\' successful results also feed the shared assignment picker', () => {
    const caFn = source.slice(source.indexOf('async function runCreateAssignment'), source.indexOf('const copySourceTitle ='))
    const copyFn = source.slice(source.indexOf('async function runCopyAssignment'), source.indexOf('const attClassroomName ='))
    expect(caFn).toContain('setAssignments(')
    expect(copyFn).toContain('setAssignments(')
  })

  it('get_missing_submissions\' and get_classroom_summary\'s successful results both feed the student picker used by get_student_summary', () => {
    const missingFn = source.slice(
      source.indexOf('async function runGetMissingSubmissions'),
      source.indexOf('async function runGetClassroomSummary'),
    )
    const summaryFn = source.slice(
      source.indexOf('async function runGetClassroomSummary'),
      source.indexOf('async function runGetStudentSummary'),
    )
    expect(missingFn).toContain('setStudents(')
    expect(summaryFn).toContain('setStudents(')
  })

  it('mark_attendance_bulk renders one status picker per roster student rather than requiring a manually-typed student list', () => {
    const card = source.slice(source.indexOf('8. mark_attendance_bulk'), source.indexOf('<ConfirmDialog\n        open={attConfirmOpen}'))
    expect(card).toContain('roster.map((student) =>')
  })

  it('copy_assignment_to_classrooms offers target classrooms as checkboxes over known classrooms, not free-typed UUIDs', () => {
    const card = source.slice(source.indexOf('7. copy_assignment_to_classrooms'), source.indexOf('8. mark_attendance_bulk'))
    expect(card).toContain('classrooms.map((c) =>')
    expect(card).toContain('type="checkbox"')
  })

  it('every single-value picker still allows a manually-typed UUID as a fallback', () => {
    const manualInputs = source.match(/หรือระบุ \w+ เอง/g) ?? []
    expect(manualInputs.length).toBeGreaterThanOrEqual(4)
  })
})

describe('AgentToolsDevPage — result display requirements', () => {
  const source = readSource()

  it('shows the tool name, the exact request args sent, the HTTP status, and the returned data or a safe error message', () => {
    expect(source).toContain('อาร์กิวเมนต์ที่ส่ง (request args)')
    expect(source).toContain('HTTP {run.result.httpStatus}')
    expect(source).toContain('ข้อมูลที่ได้รับ (data)')
    expect(source).toContain('run.result.error.message')
  })

  it('never dumps a raw thrown error/exception object — only the typed AgentToolResponse fields', () => {
    expect(source).not.toMatch(/\{String\(err\)\}|\{err\.stack\}|\{err\.toString/)
  })

  it('create_assignment displays the created assignment id after success', () => {
    const card = source.slice(source.indexOf('6. create_assignment'), source.indexOf('7. copy_assignment_to_classrooms'))
    expect(card).toContain('assignmentId:')
    expect(card).toContain("(caRun.result.data as { assignmentId: string }).assignmentId")
  })
})

describe('router.tsx — the dev panel is teacher-only and NOT on the production sidebar', () => {
  const routerSource = readRouterSource()
  const navItemsSource = readNavItemsSource()

  it('is mounted as a child route inside /teacher, i.e. behind the same ProtectedRoute + TeacherLayout as every real teacher page', () => {
    const teacherBlockStart = routerSource.indexOf("path: '/teacher'")
    const teacherBlockEnd = routerSource.indexOf("path: '*'")
    const teacherBlock = routerSource.slice(teacherBlockStart, teacherBlockEnd)
    expect(teacherBlock).toContain('<ProtectedRoute>')
    expect(teacherBlock).toContain("path: 'dev/agent-tools'")
    expect(teacherBlock).toContain('<AgentToolsDevPage />')
  })

  it('is never added to the sidebar nav-items list (kept out of everyday teacher navigation as a temporary diagnostic tool)', () => {
    expect(navItemsSource).not.toMatch(/agent-tools|AgentTools/i)
  })
})
