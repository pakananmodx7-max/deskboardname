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

  it('save only succeeds after saveAttendance (the Supabase RPC call) resolves — setSaveState(\'saved\') is inside the try block, after the await', () => {
    const fn = source.slice(source.indexOf('async function handleSave'), source.indexOf('useEffect(() => {\n    return () => {'))
    expect(fn).toMatch(/await saveAttendance\([\s\S]*setSaveState\('saved'\)/)
  })

  it('on a failed save, the roster records are left completely untouched — no setRecords/setStudents call in the catch block', () => {
    const fn = source.slice(source.indexOf('async function handleSave'), source.indexOf('useEffect(() => {\n    return () => {'))
    const catchBlock = fn.slice(fn.indexOf('catch (err)'))
    expect(catchBlock).not.toMatch(/setRecords|setStudents/)
    expect(catchBlock).toContain("setSaveState('error')")
  })
})

describe('AttendanceTab — three-state save indicator (Production Bug fix, Section 6)', () => {
  const source = readSource()

  it('shows all three required states: กำลังบันทึก.../บันทึกแล้ว/บันทึกไม่สำเร็จ', () => {
    expect(source).toContain('กำลังบันทึก...')
    expect(source).toContain('บันทึกแล้ว')
    expect(source).toContain('บันทึกไม่สำเร็จ')
  })

  it('the save button disables while saving, preventing a duplicate concurrent save', () => {
    expect(source).toContain("disabled={saveState === 'saving'")
  })
})

describe('AttendanceTab — saved-session race fix (Production Bug fix, Section 5)', () => {
  const source = readSource()

  it('tracks which students the teacher has already edited since the current load started', () => {
    expect(source).toContain('editedIdsRef')
    expect(source).toMatch(/editedIdsRef\.current = new Set\(\)/)
  })

  it('every status/note edit records the student id as edited before updating local state', () => {
    const setStatusFn = source.slice(source.indexOf('function setStatus'), source.indexOf('function setNote'))
    const setNoteFn = source.slice(source.indexOf('function setNote'), source.indexOf('async function handleSave'))
    expect(setStatusFn).toContain('editedIdsRef.current.add(studentId)')
    expect(setNoteFn).toContain('editedIdsRef.current.add(studentId)')
  })

  it('the delayed saved-session fetch merges through mergeLoadedAttendance instead of blindly replacing records — this is the actual race fix', () => {
    expect(source).toContain('mergeLoadedAttendance(prev, loaded, editedIdsRef.current)')
    // The old, buggy shape directly replaced records with no merge step —
    // guard against ever regressing back to it.
    expect(source).not.toMatch(/setRecords\(buildRecordsForRoster\(activeIds, attendance\)\)/)
  })

  it('the roster fetch and the attendance-session fetch remain two independent requests (not Promise.all) — the pre-existing "0 students" fix must not regress', () => {
    expect(source).not.toMatch(/Promise\.all\(\[getStudentsByClassroom/)
  })
})

describe('AttendanceTab — real classroom+subject scoping (Section 8/9)', () => {
  const source = readSource()

  it('always sends subject.id and the current classroom to both the read and the write path', () => {
    expect(source).toContain('getAttendance(classroomId, date, subject.id, periodNumber)')
    expect(source).toContain('saveAttendance(classroomId, date, recordsToSave, subject.id, periodNumber)')
  })
})
