import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./attendance-tab.tsx', import.meta.url), 'utf-8')
}

describe('AttendanceTab — no fake local-only success, no demo fallback (Production Bug fix, Section 4/6)', () => {
  const source = readSource()

  it('reads real students from getStudentsByClassroom — no demo import anywhere', () => {
    expect(source).toContain('getStudentsByClassroom')
    expect(source).not.toMatch(/from ['"]@\/demo\//)
  })

  it('success is only shown after the server confirms: the auto-save engine marks a change saved in the RPC promise\'s success handler', () => {
    const engine = readFileSync(new URL('../../attendance/attendance-autosave.ts', import.meta.url), 'utf-8')
    const flush = engine.slice(engine.indexOf('private flush()'), engine.indexOf('private finishRequest()'))
    expect(flush).toMatch(/this\.opts\.save\(records\)\.then\(\s*\(\) => \{[\s\S]*this\.everSaved = true/)
    const failure = flush.slice(flush.indexOf('(err: unknown) =>'))
    expect(failure).not.toMatch(/this\.desired =|this\.confirmed =/)
  })
})

describe('AttendanceTab — auto-save states', () => {
  const source = readSource()
  const board = readFileSync(new URL('../../attendance/attendance-board.tsx', import.meta.url), 'utf-8')

  it('shows all three required states: กำลังบันทึก.../บันทึกแล้ว/บันทึกไม่สำเร็จ — ลองอีกครั้ง', () => {
    expect(board).toContain('กำลังบันทึก...')
    expect(board).toContain('บันทึกแล้ว')
    expect(board).toContain('บันทึกไม่สำเร็จ — ลองอีกครั้ง')
  })

  it('no save button and no toast after a successful save', () => {
    expect(source).not.toContain('บันทึกการเช็คชื่อเรียบร้อยแล้ว')
    expect(source).not.toContain('onSave=')
  })

  it('the roster fetch and the attendance-session fetch remain two independent requests (not Promise.all)', () => {
    expect(source).not.toMatch(/Promise\.all\(\[getStudentsByClassroom/)
  })
})

describe('AttendanceTab — real classroom+subject scoping (Section 8/9)', () => {
  const source = readSource()

  it('always sends subject.id and the current classroom to both the read and the write path', () => {
    expect(source).toContain('getAttendance(classroomId, date, subject.id, periodNumber)')
    expect(source).toContain('saveAttendance(classroomId, date, records, subject.id, periodNumber)')
  })
})

describe('AttendanceTab — export attendance (Google Sheets Integration, Section 3/6)', () => {
  const source = readSource()

  it('exports through getAllAttendanceForClassroom scoped to this exact classroom AND subject — never every subject or another classroom', () => {
    expect(source).toContain('getAllAttendanceForClassroom(classroomId, subject.id)')
  })

  it('downloads via the shared downloadCsv/ExportTable pipeline — never a locally reimplemented CSV writer (formula-injection guard + Thai UTF-8 BOM stay centralized)', () => {
    expect(source).toContain("from '@/lib/export/csv-export'")
    expect(source).toContain('buildClassroomAttendanceExportTable')
  })

  it('an export failure surfaces a toast and never touches the on-screen roster state', () => {
    const fn = source.slice(source.indexOf('async function handleExport'), source.indexOf('const roster = deriveAttendanceRoster'))
    const catchBlock = fn.slice(fn.indexOf('catch (err)'))
    expect(catchBlock).not.toMatch(/setRecords|setStudents/)
    expect(catchBlock).toContain('toast(')
  })
})
