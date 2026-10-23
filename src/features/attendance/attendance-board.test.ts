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
    saveStatus: 'idle',
    onChange: noop,
    onRetry: noop,
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

  it('no manual save button: an auto-save indicator instead', () => {
    const html = render()
    expect(html).not.toContain('บันทึกการเช็คชื่อ</span>')
    expect(html).not.toContain('lucide-save')
    expect(html).toContain('บันทึกอัตโนมัติ')
    expect(render({ saveStatus: 'saved' })).toContain('บันทึกแล้ว')
  })

  it('pending changes: card marked, indicator says กำลังบันทึก..., editing stays enabled', () => {
    const html = render({ entries: withStatus(BASELINE, 'c', 'late'), saveStatus: 'saving' })
    expect(html).toContain('data-changed="true"')
    expect(html).toContain('กำลังบันทึก...')
    expect(html).not.toMatch(/aria-label="จักรพงศ์ ด่วนชะเอม: มาสาย — คลิกเพื่อเปลี่ยนสถานะ"[^>]*disabled=""/)
    const presentAll = html.match(/<button[^>]*>(?:(?!<\/button>).)*มาครบทุกคน/)?.[0] ?? ''
    expect(presentAll).toContain('มาครบทุกคน')
    expect(presentAll).not.toContain('disabled=""')
  })

  it('failed save: card marked failed, alert with the reason and a retry, never "บันทึกแล้ว"', () => {
    const html = render({ entries: withStatus(BASELINE, 'c', 'late'), saveStatus: 'error', failedIds: new Set(['c']), saveError: 'คุณไม่มีสิทธิ์' })
    expect(html).toContain('data-save-failed="true"')
    expect(html).toContain('บันทึกไม่สำเร็จ — ลองอีกครั้ง')
    expect(html).toContain('บันทึกไม่สำเร็จ 1 รายการ')
    expect(html).toContain('คุณไม่มีสิทธิ์')
    expect(html).toContain('ลองอีกครั้ง')
    expect(html).not.toContain('บันทึกแล้ว')
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
      expect(source).toMatch(/<UnsavedChangesGuard when=\{dirty\}/)
      expect(source).toMatch(/useAttendanceAutoSave\(\s*sessionKey,/)
    }
  })

  it('real auto-save: the same RPC, only changed+checked records, scoped to the session it was made in', () => {
    expect(realTab).toContain('saveAttendance(classroomId, date, records, subject.id, periodNumber)')
    expect(realTab).toContain('const sessionKey = `${classroomId}|${subject.id}|${date}|${periodNumber ?? \'\'}`')
    expect(realTab).not.toMatch(/handleSave|<Save|lucide-react'.*Save/)
  })

  it('real: editing is locked when the saved session fails to load (no blind overwrite)', () => {
    expect(realTab).toContain('lockedReason={attendanceError}')
  })

  it('demo save writes statuses and notes in one store update; Demo Mode never touches Supabase', () => {
    expect(demoTab).toContain('saveSubjectAttendanceEntries(subject.id, classroomId, date, records)')
    expect(demoTab).not.toMatch(/supabase|attendance-service/)
  })

  it('changing date/คาบ finishes pending saves first; asks before dropping a failed one', () => {
    expect(realTab).toContain('const saved = await autosave.flushNow()')
    expect(realTab).toContain('setPendingSelection(next)')
    expect(realTab).toContain('autosave.discard()')
    expect(demoTab).toContain('await autosave.flushNow()')
    expect(demoTab).toContain('setPendingDate(next)')
  })

  it('dashboard attendance analytics reload on every dashboard visit (not cached at layout level), so a save here is reflected there', () => {
    const dashboard = readSource('../../pages/teacher/dashboard/dashboard-page-real.tsx')
    const semesterProvider = readSource('../semester/semester-context.tsx')
    expect(dashboard).toContain('useSemesterAnalyticsData(')
    expect(semesterProvider).not.toMatch(/getAnalyticsAttendance|loaders\.attendance|supabaseAnalyticsLoaders\.attendance/)
  })
})
