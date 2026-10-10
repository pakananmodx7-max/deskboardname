import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AttendanceBoard, type AttendanceBoardProps } from './attendance-board'
import { decodeRecords, SICK_NOTE_PREFIX, withStatus } from './attendance-board-model'

const STUDENTS = [
  { id: 'a', number: 1, firstName: 'กฤษกร', lastName: 'สีราเลา', nickname: 'ทดลอง' },
  { id: 'b', number: 2, firstName: 'กัลยวรรณ', lastName: 'ทองคำ', nickname: 'ตาล' },
  { id: 'c', number: 3, firstName: 'จักรพงศ์', lastName: 'ด่วนชะเอม', nickname: null },
]
const BASELINE = decodeRecords(['a', 'b', 'c'], {
  a: { studentId: 'a', status: 'present', note: null },
  b: { studentId: 'b', status: 'leave', note: `${SICK_NOTE_PREFIX} ไข้` },
})
const noop = () => {}

function render(overrides: Partial<AttendanceBoardProps> = {}): string {
  const props: AttendanceBoardProps = {
    students: STUDENTS,
    entries: BASELINE,
    baseline: BASELINE,
    loading: false,
    saving: false,
    onChange: noop,
    onSave: noop,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(AttendanceBoard, props))
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

describe('AttendanceBoard (rendered)', () => {
  it('cards show number, initials, full name, nickname and a status-colored card', () => {
    const html = render()
    expect(html).toContain('กฤษกร สีราเลา')
    expect(html).toContain('ทดลอง')
    expect(html).toContain('>กส<')
    expect(html).toMatch(/data-status="present"[^>]*class="[^"]*border-success/)
    expect(html).toMatch(/data-status="sick"[^>]*class="[^"]*border-sky-500/)
    expect(html).toMatch(/data-status="unchecked"/)
  })

  it('summary bar, status filters with counts, grid/list toggle, bulk actions', () => {
    const html = render()
    for (const label of ['มาเรียน', 'มาสาย', 'ขาดเรียน', 'ลากิจ', 'ลาป่วย', 'ยังไม่เช็ค', 'รวมทั้งหมด', '3 คน']) expect(html).toContain(label)
    expect(html).toContain('aria-label="แสดงแบบการ์ด"')
    expect(html).toContain('aria-label="แสดงแบบรายการ"')
    expect(html).toMatch(/ที่เหลือขาดเรียน \((<!-- -->)?1(<!-- -->)? คน\)/)
    expect(html).toContain('มาครบทุกคน')
    expect(html).toContain('placeholder="ค้นหาชื่อนักเรียน เลขที่ หรือหมายเหตุ..."')
  })

  it('no changes: save disabled and "ไม่มีการเปลี่ยนแปลง"', () => {
    const html = render()
    expect(html).toContain('ไม่มีการเปลี่ยนแปลง')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?บันทึกการเช็คชื่อ/)
  })

  it('unsaved edits are visible: changed card highlighted and counted, save enabled', () => {
    const html = render({ entries: withStatus(BASELINE, 'c', 'late') })
    expect(html).toContain('data-changed="true"')
    expect(html).toContain('ยังไม่บันทึก')
    expect(html).toContain('มีการเปลี่ยนแปลงที่ยังไม่บันทึก 1 รายการ')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*><svg[^>]*lucide-save/)
  })

  it('locked (saved session failed to load): reason shown, cards and actions disabled', () => {
    const html = render({ lockedReason: 'โหลดไม่สำเร็จ', entries: withStatus(BASELINE, 'c', 'late') })
    expect(html).toContain('role="alert"')
    expect(html).toContain('โหลดไม่สำเร็จ')
    // Unknown saved data: the summary shows dashes, never "all unchecked".
    expect(html).toContain('ยังไม่เช็ค <span class="tabular-nums">(-)</span>')
    expect(html).toMatch(/aria-label="จักรพงศ์ ด่วนชะเอม: มาสาย — คลิกเพื่อเปลี่ยนสถานะ"[^>]*disabled=""|disabled=""[^>]*aria-label="จักรพงศ์ ด่วนชะเอม: มาสาย/)
  })

  it('loading shows skeletons, never an empty roster; empty classroom says so', () => {
    expect(render({ loading: true })).toContain('aria-label="กำลังโหลดรายชื่อ"')
    expect(render({ loading: true })).not.toContain('ยังไม่มีนักเรียนในห้องเรียนนี้')
    expect(render({ students: [], entries: {}, baseline: {} })).toContain('ยังไม่มีนักเรียนในห้องเรียนนี้')
  })

  it('saving: every card and bulk action is disabled (no edits mid-save)', () => {
    const html = render({ saving: true, entries: withStatus(BASELINE, 'c', 'late') })
    expect(html).toContain('กำลังบันทึก...')
    expect(html).toMatch(/disabled=""[^>]*>.*?มาครบทุกคน/)
  })
})

describe('board wiring (source checks)', () => {
  const board = readSource('./attendance-board.tsx')
  const realTab = readSource('../subjects-real/tabs/attendance-tab.tsx')
  const demoTab = readSource('../demo-subjects/tabs/attendance-tab.tsx')

  it('bulk actions always go through a confirmation dialog', () => {
    expect(board).toContain("onClick={() => setBulk('absent')}")
    expect(board).toContain("onClick={() => setBulk('present')}")
    expect(board).toContain('open={bulk !== null}')
    expect(board).toContain('onConfirm={applyBulk}')
  })

  it('per-card three-dot menu offers every status and a note', () => {
    expect(board).toContain('<RowActionsMenu actions={menuFor(student)}')
    expect(board).toContain("'แก้ไขหมายเหตุ' : 'เพิ่มหมายเหตุ'")
  })

  it('both modes use the same board and the unsaved-changes guard', () => {
    for (const source of [realTab, demoTab]) {
      expect(source).toContain('<AttendanceBoard')
      expect(source).toContain('<UnsavedChangesGuard when={dirty} />')
    }
  })

  it('real save: one guarded RPC call with only the changed+checked records, edits kept on failure', () => {
    expect(realTab).toContain('if (savingRef.current ||')
    expect(realTab).toContain('const recordsToSave = buildRecordsToSave(rosterIds, entries, baseline)')
    expect(realTab).toContain('await saveAttendance(classroomId, date, recordsToSave, subject.id, periodNumber)')
    const catchBlock = realTab.slice(realTab.indexOf('} catch (err) {', realTab.indexOf('async function handleSave')), realTab.indexOf('} finally {', realTab.indexOf('async function handleSave')))
    expect(catchBlock).not.toMatch(/setEntries|setBaseline/)
  })

  it('real: editing is locked when the saved session fails to load (no blind overwrite)', () => {
    expect(realTab).toContain('lockedReason={attendanceError}')
    expect(realTab).toContain('Boolean(attendanceError)')
  })

  it('demo save writes statuses and notes in one store update; Demo Mode never touches Supabase', () => {
    expect(demoTab).toContain('saveSubjectAttendanceEntries(subject.id, classroomId, date, recordsToSave)')
    expect(demoTab).not.toMatch(/supabase|attendance-service/)
  })

  it('changing date/คาบ with unsaved edits asks first', () => {
    expect(realTab).toContain('setPendingSelection(next)')
    expect(demoTab).toContain('setPendingDate(next)')
  })

  it('dashboard attendance analytics reload on every dashboard visit (not cached at layout level), so a save here is reflected there', () => {
    const dashboard = readSource('../../pages/teacher/dashboard/dashboard-page-real.tsx')
    const semesterProvider = readSource('../semester/semester-context.tsx')
    expect(dashboard).toContain('useSemesterAnalyticsData(')
    expect(semesterProvider).not.toMatch(/getAnalyticsAttendance|loaders\.attendance|supabaseAnalyticsLoaders\.attendance/)
  })
})
