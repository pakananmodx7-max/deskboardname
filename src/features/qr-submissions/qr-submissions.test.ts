import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Assignment, AssignmentSubmission } from '@/types/assignment'

import { cameraErrorMessage } from './camera-support'
import { buildQrPayload, canonicalQrPayload, normalizeScannedText, parseQrPayload, QR_PAYLOAD_PREFIX } from './qr-payload'
import { buildQrPrintDocument, CARDS_PER_SHEET, escapeHtml, qrPngFileName, type QrCard } from './qr-print-model'
import {
  applyScanResult,
  CAMERA_OUT_OF_VIEW_MS,
  cameraStillInView,
  countSubmissions,
  describeSubmissionWindow,
  effectiveDeadline,
  feedbackFor,
  isoToSchoolLocalInput,
  isRepeatScan,
  matchesStudentQuery,
  parseScanResult,
  SAME_SCAN_WINDOW_MS,
  schoolLocalInputToIso,
  scoreDisplay,
  submissionStatusDisplay,
  type ScanResult,
} from './scan-model'

const TOKEN = '1e4604a5b4dc428c93760ca1de282f5793fb89f5c5d44bf5b4f1bcf8407a74e1'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf-8')

/** US key → the Thai (Kedmanee) character it types, for the test only. */
const US_TO_KEDMANEE: Record<string, string> = {
  1: 'ๅ', 2: '/', 3: '-', 4: 'ภ', 5: 'ถ', 6: 'ุ', 7: 'ึ', 8: 'ค', 9: 'ต', 0: 'จ',
  a: 'ฟ', b: 'ิ', c: 'แ', d: 'ก', e: 'ำ', f: 'ด', k: 'า', q: 'ๆ', r: 'พ',
}
const typedWithThaiLayout = (s: string) => [...s].map((c) => US_TO_KEDMANEE[c] ?? c).join('')

const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'a1',
  subjectId: 's1',
  classroomId: 'c1',
  topicId: null,
  title: 'งานที่ 1',
  description: null,
  maxScore: 5,
  dueDate: null,
  isArchived: false,
  createdBy: null,
  createdAt: '',
  updatedAt: '',
  submissionDeadline: null,
  latePolicy: 'accept_late',
  acceptingSubmissions: true,
  ...over,
})

describe('QR payload — opaque token, scanner-robust', () => {
  it('carries only the prefix + random token (no name, code or id)', () => {
    expect(buildQrPayload(TOKEN)).toBe(`${QR_PAYLOAD_PREFIX}${TOKEN}`)
    expect(buildQrPayload(TOKEN)).toMatch(/^kcqr1[0-9a-f]{64}$/)
  })

  it('parses the payload, a bare token, upper case and scanner suffixes', () => {
    expect(parseQrPayload(`kcqr1${TOKEN}`)).toBe(TOKEN)
    expect(parseQrPayload(TOKEN)).toBe(TOKEN)
    expect(parseQrPayload(`KCQR1${TOKEN.toUpperCase()}\r\n`)).toBe(TOKEN)
    expect(parseQrPayload(` kcqr1${TOKEN}\t`)).toBe(TOKEN)
  })

  it('undoes a Thai (Kedmanee) keyboard layout from an HID scanner', () => {
    const typed = typedWithThaiLayout(`kcqr1${TOKEN}`)
    expect(typed).not.toContain('k')
    expect(normalizeScannedText(typed)).toBe(`kcqr1${TOKEN}`)
    expect(canonicalQrPayload(typed)).toBe(`kcqr1${TOKEN}`)
  })

  it('rejects anything else (URLs, short/long tokens, other prefixes)', () => {
    for (const bad of ['', 'https://example.com/?id=1', `kcqr1${TOKEN.slice(1)}`, `kcqr1${TOKEN}0`, `kcqr2${TOKEN}`, `kcqr1${TOKEN.replace('a', 'g')}`, '00000000-00e2-0002-0000-000000000001']) {
      expect(parseQrPayload(bad)).toBeNull()
    }
  })
})

describe('deadlines (school time, same rule as the database)', () => {
  it('exact deadline wins; else due date until 23:59:59 Bangkok; else none', () => {
    expect(effectiveDeadline(assignment({ submissionDeadline: '2026-10-21T03:00:00.000Z', dueDate: '2026-10-25' }))?.toISOString()).toBe('2026-10-21T03:00:00.000Z')
    expect(effectiveDeadline(assignment({ dueDate: '2026-10-25' }))?.toISOString()).toBe('2026-10-25T16:59:59.000Z')
    expect(effectiveDeadline(assignment())).toBeNull()
  })

  it('datetime-local values are school time and round-trip', () => {
    expect(schoolLocalInputToIso('2026-10-25T08:30')).toBe('2026-10-25T01:30:00.000Z')
    expect(isoToSchoolLocalInput('2026-10-25T01:30:00.000Z')).toBe('2026-10-25T08:30')
    expect(schoolLocalInputToIso('25/10/2026')).toBeNull()
    expect(isoToSchoolLocalInput(null)).toBe('')
  })

  it('describes the window, including closed and reject-late', () => {
    expect(describeSubmissionWindow(assignment())).toBe('เปิดรับงาน · ไม่มีกำหนดส่ง')
    expect(describeSubmissionWindow(assignment({ acceptingSubmissions: false }))).toBe('ปิดรับงานแล้ว')
    expect(describeSubmissionWindow(assignment({ submissionDeadline: '2026-10-25T01:30:00.000Z', latePolicy: 'reject_late' }))).toMatch(/^กำหนดส่ง .* · ไม่รับงานหลังกำหนด$/)
  })
})

describe('status and score are separate', () => {
  const withDeadline = assignment({ submissionDeadline: '2026-10-25T10:00:00.000Z' })

  it('"ส่งตรงเวลา" only with evidence; no deadline or no timestamp reads "ส่งแล้ว"', () => {
    expect(submissionStatusDisplay({ status: 'submitted', submittedAt: '2026-10-25T09:00:00.000Z' }, withDeadline).label).toBe('ส่งตรงเวลา')
    expect(submissionStatusDisplay({ status: 'submitted', submittedAt: '2026-10-25T09:00:00.000Z' }, assignment()).label).toBe('ส่งแล้ว')
    expect(submissionStatusDisplay({ status: 'submitted', submittedAt: null }, withDeadline).label).toBe('ส่งแล้ว')
    expect(submissionStatusDisplay({ status: 'late', submittedAt: '2026-10-26T00:00:00.000Z' }, withDeadline).label).toBe('ส่งช้า')
    expect(submissionStatusDisplay({ status: 'excused', submittedAt: null }, withDeadline).label).toBe('ยกเว้น')
    expect(submissionStatusDisplay({ status: 'missing', submittedAt: null }, withDeadline).label).toBe('ขาดส่ง')
    expect(submissionStatusDisplay(null, withDeadline).label).toBe('ยังไม่ส่ง')
  })

  it('scores never come from the status (ส่งตรงเวลา 3/5 · ส่งช้า 5/5 · ยังไม่ตรวจคะแนน · ไม่มีการส่งงาน)', () => {
    expect(scoreDisplay({ status: 'submitted', score: 3 }, 5)).toBe('3/5')
    expect(scoreDisplay({ status: 'late', score: 5 }, 5)).toBe('5/5')
    expect(scoreDisplay({ status: 'submitted', score: null }, 5)).toBe('ยังไม่ตรวจคะแนน')
    expect(scoreDisplay({ status: 'not_submitted', score: null }, 5)).toBe('ไม่มีการส่งงาน')
    expect(scoreDisplay(undefined, 5)).toBe('ไม่มีการส่งงาน')
    // An existing 0/5 stays a score — it is never read as "not submitted".
    expect(scoreDisplay({ status: 'not_submitted', score: 0 }, 5)).toBe('0/5')
  })

  it('counts per assignment (excused is neither submitted nor pending)', () => {
    const subs: Record<string, Pick<AssignmentSubmission, 'status' | 'submittedAt'>> = {
      a: { status: 'submitted', submittedAt: '2026-10-25T09:00:00.000Z' },
      b: { status: 'late', submittedAt: '2026-10-26T00:00:00.000Z' },
      c: { status: 'excused', submittedAt: null },
      d: { status: 'missing', submittedAt: null },
    }
    expect(countSubmissions(['a', 'b', 'c', 'd', 'e'], subs, withDeadline)).toEqual({ total: 5, onTime: 1, submitted: 2, late: 1, notSubmitted: 1, missing: 1, excused: 1 })
  })
})

describe('server results', () => {
  const raw = {
    outcome: 'recorded',
    server_time: '2026-10-20T13:00:00Z',
    deadline: null,
    student: { id: 's1', first_name: 'อนันต์', last_name: 'ใจดี', number: 1, student_code: '65001', avatar_path: null },
    submission: { id: 'sub1', status: 'submitted', submitted_at: '2026-10-20T13:00:00Z', score: 3, recorded_via: 'qr_scan' },
  }

  it('parses and validates the RPC result; unknown outcomes are errors, never success', () => {
    const r = parseScanResult(raw)
    expect(r.outcome).toBe('recorded')
    expect(r.student).toEqual({ id: 's1', firstName: 'อนันต์', lastName: 'ใจดี', number: 1, studentCode: '65001', avatarPath: null })
    expect(r.submission).toEqual({ id: 'sub1', status: 'submitted', submittedAt: '2026-10-20T13:00:00Z', score: 3 })
    expect(() => parseScanResult({ outcome: 'ok' })).toThrow()
    expect(() => parseScanResult(null)).toThrow()
    expect(parseScanResult({ outcome: 'invalid_qr' }).student).toBeNull()
  })

  it('only "recorded" is a success; every other outcome is a warning or error', () => {
    const outcomes = ['recorded', 'duplicate', 'excused', 'invalid_qr', 'revoked_qr', 'not_in_roster', 'assignment_closed', 'deadline_passed'] as const
    const kinds = outcomes.map((outcome) => feedbackFor({ ...parseScanResult(raw), outcome } as ScanResult, assignment()).kind)
    expect(kinds).toEqual(['success', 'warning', 'warning', 'error', 'error', 'error', 'error', 'error'])
    expect(feedbackFor(parseScanResult(raw), assignment()).title).toBe('บันทึกแล้ว: อนันต์ ใจดี')
  })

  it('merging a confirmed result keeps the teacher note and takes the server score', () => {
    const before: Record<string, AssignmentSubmission> = { s1: { studentId: 's1', status: 'missing', score: 3, note: 'ครูบันทึก', submittedAt: null } }
    const after = applyScanResult(before, parseScanResult(raw))
    expect(after.s1).toMatchObject({ status: 'submitted', score: 3, note: 'ครูบันทึก', submittedAt: '2026-10-20T13:00:00Z' })
    // No student/submission (e.g. invalid QR) → unchanged.
    expect(applyScanResult(before, parseScanResult({ outcome: 'invalid_qr' }))).toBe(before)
  })
})

describe('rapid input and duplicates', () => {
  it('same scan within the window is ignored; a different student is not', () => {
    const recent = { key: 'a1:x', at: 1000 }
    expect(isRepeatScan(recent, 'a1:x', 1000 + SAME_SCAN_WINDOW_MS - 1)).toBe(true)
    expect(isRepeatScan(recent, 'a1:x', 1000 + SAME_SCAN_WINDOW_MS)).toBe(false)
    expect(isRepeatScan(recent, 'a1:y', 1001)).toBe(false)
    // Same student, different assignment → a new scan.
    expect(isRepeatScan(recent, 'a2:x', 1001)).toBe(false)
  })

  it('camera: one QR held in view counts once; it counts again after leaving the frame', () => {
    let seen = cameraStillInView(null, 'k', 0)
    expect(seen.stillInView).toBe(false)
    for (let t = 140; t < 10_000; t += 140) {
      seen = cameraStillInView(seen.next, 'k', t)
      expect(seen.stillInView).toBe(true)
    }
    expect(cameraStillInView(seen.next, 'k', seen.next.at + CAMERA_OUT_OF_VIEW_MS).stillInView).toBe(false)
  })

  it('search by name, nickname, code or number', () => {
    const s = { firstName: 'อนันต์', lastName: 'ใจดี', number: 12, studentCode: '65001', nickname: 'นัน' }
    expect(matchesStudentQuery(s, 'อนันต์ ใจ')).toBe(true)
    expect(matchesStudentQuery(s, '12')).toBe(true)
    expect(matchesStudentQuery(s, '6500')).toBe(true)
    expect(matchesStudentQuery(s, 'นัน')).toBe(true)
    expect(matchesStudentQuery(s, 'บุษบา')).toBe(false)
  })
})

describe('printable cards', () => {
  const card = (i: number): QrCard => ({ studentName: `นักเรียน ${i}`, classroomName: 'ม.5/1', number: i, studentCode: `650${i}`, qrDataUrl: 'data:image/png;base64,AAAA' })

  it('A4 sheets of 12, page breaks between pages, roster order kept', () => {
    const html = buildQrPrintDocument(Array.from({ length: 25 }, (_, i) => card(i + 1)), 'sheet', 'QR')
    expect((html.match(/<section class="sheet/g) ?? []).length).toBe(3)
    expect((html.match(/page-break"/g) ?? []).length).toBe(2)
    expect((html.match(/<figure class="card">/g) ?? []).length).toBe(25)
    expect(CARDS_PER_SHEET).toBe(12)
    expect(html).toContain('@page { size: A4')
    expect(html.indexOf('นักเรียน 1<')).toBeLessThan(html.indexOf('นักเรียน 2<'))
  })

  it('single card print, Thai document, escaped text, no token in the markup', () => {
    const html = buildQrPrintDocument([{ ...card(1), studentName: '<script>x</script>' }], 'single', 'QR')
    expect(html).toContain('<html lang="th">')
    expect(html).toContain('class="single"')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/[0-9a-f]{64}/)
    expect(escapeHtml(`a&b"c'`)).toBe('a&amp;b&quot;c&#39;')
  })

  it('PNG file names are filesystem-safe', () => {
    expect(qrPngFileName({ studentName: 'อนันต์ ใจดี', classroomName: 'ม.5/1', number: 1 })).toBe('QR_ม.5-1_1_อนันต์_ใจดี.png')
  })
})

describe('camera behaviour (permissions, cleanup)', () => {
  const camera = read('./camera-scanner.tsx')

  it('Thai messages for denied / missing / busy / unsupported cameras', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/ไม่ได้รับอนุญาตให้ใช้กล้อง/)
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toMatch(/ไม่พบกล้อง/)
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toMatch(/ถูกใช้งานโดยแอปอื่น/)
    expect(cameraErrorMessage({ name: 'unsupported' })).toMatch(/HTTPS/)
  })

  it('asks for the camera only from the "เปิดกล้อง" action, prefers the rear camera', () => {
    expect(camera).toContain("facingMode: { ideal: 'environment' }")
    const effects = camera.split('useEffect(').slice(1).map((e) => e.slice(0, e.indexOf('}, [')))
    for (const effect of effects) expect(effect).not.toContain('getUserMedia')
    expect(camera).toContain('onClick={() => void start()}')
  })

  it('stops every track on unmount, on close and when the page is hidden; pauses while saving', () => {
    expect(camera).toContain('getTracks().forEach((track) => track.stop())')
    expect(camera).toMatch(/return \(\) => \{\s*document\.removeEventListener\('visibilitychange', onHidden\)\s*stop\(\)/)
    expect(camera).toContain("document.visibilityState === 'hidden'")
    expect(camera).toContain('if (!pausedRef.current && video.readyState >= 2')
  })
})

describe('Bluetooth/USB (HID) input', () => {
  const hid = read('./hid-scanner-input.tsx')

  it('Enter never submits a form or navigates; no-Enter scanners submit after an idle', () => {
    expect(hid).toMatch(/if \(e\.key === 'Enter' \|\| e\.key === 'Tab'\) \{\s*\/\/[^\n]*\n\s*e\.preventDefault\(\)\s*e\.stopPropagation\(\)/)
    expect(hid).toContain('if (parseQrPayload(value)) idleRef.current = window.setTimeout(flush, IDLE_SUBMIT_MS)')
    expect(hid).not.toContain('<form')
  })

  it('no on-screen keyboard, no autocorrect, focus restored, readiness shown', () => {
    expect(hid).toContain('inputMode="none"')
    expect(hid).toContain('autoComplete="off"')
    expect(hid).toContain("window.addEventListener('focus', focus)")
    expect(hid).toContain('พร้อมรับการสแกน')
  })
})

describe('scanner screen guarantees (source)', () => {
  const dialog = read('./scan-submissions-dialog.tsx')

  it('a scan always targets the assignment selected when it was scanned', () => {
    expect(dialog).toContain('const assignmentId = selectedRef.current')
    expect(dialog).toContain('queue.current.push({ ...job, key, assignmentId })')
    expect(dialog).toMatch(/recordSubmissionScan\(job\.assignmentId, job\.value\)/)
    expect(dialog).toContain('if (selectedRef.current === job.assignmentId)')
  })

  it('results are shown only after the server answered; jobs run one at a time', () => {
    const job = dialog.slice(dialog.indexOf('const processJob'), dialog.indexOf('const pump'))
    expect(job.indexOf('await record')).toBeLessThan(job.indexOf('setLatest({ ...') === -1 ? job.indexOf('setLatest(entry)') : job.indexOf('setLatest({ ...'))
    expect(dialog).toContain('while (queue.current.length > 0)')
    expect(dialog).toContain('await processJob(job)')
  })

  it('never sends a timestamp or a status for a scan', () => {
    const service = read('../../services/qr-submission-service.ts')
    const scan = service.slice(service.indexOf('export async function recordSubmissionScan'), service.indexOf('export interface CorrectionResult'))
    expect(scan).not.toMatch(/submitted_at|new Date|status:/)
    expect(scan).toContain("rpc<unknown>('record_submission_scan', { p_assignment_id: assignmentId, p_qr_payload: payload })")
  })

  it('no offline queue: a failed request is reported, never stored for later', () => {
    expect(dialog).not.toMatch(/localStorage\.setItem\([^)]*queue|indexedDB/i)
    expect(dialog).toContain("'บันทึกไม่สำเร็จ — ยังไม่ได้บันทึก'")
  })

  it('every feedback message is Thai', () => {
    const raw = { outcome: 'recorded', student: { id: 's', first_name: 'ก', last_name: 'ข' }, submission: { id: 'x', status: 'submitted', submitted_at: null } }
    for (const outcome of ['recorded', 'duplicate', 'excused', 'invalid_qr', 'revoked_qr', 'not_in_roster', 'assignment_closed', 'deadline_passed']) {
      const f = feedbackFor(parseScanResult({ ...raw, outcome }), assignment())
      expect(f.title).toMatch(/[\u0E00-\u0E7F]/)
      expect(f.detail).toMatch(/[\u0E00-\u0E7F]/)
    }
  })
})

describe('integration with the existing screens (source)', () => {
  it('ตรวจงานและคะแนน: prominent scan button + per-column action; matrix re-fetch after changes', () => {
    const tab = read('../subjects-real/tabs/check-and-grades-tab.tsx')
    expect(tab).toContain('สแกน QR ตรวจงาน')
    expect(tab).toContain('if (changed) setDataVersion((v) => v + 1)')
    const matrix = read('../subjects-real/tabs/submission-check-tab.tsx')
    expect(matrix).toContain("label: 'สแกน QR งานนี้'")
  })

  it('roster: QR button + print all, every existing action kept', () => {
    const roster = read('../classroom-management/tabs/classroom-students-tab.tsx')
    expect(roster).toContain('พิมพ์ QR ทั้งห้อง')
    expect(roster).toContain('aria-label={`QR Code ของ ${student.firstName} ${student.lastName}`}')
    for (const key of ['view', 'edit', 'message', 'move', 'remove', 'delete']) expect(roster).toContain(`key: '${key}'`)
  })
})
