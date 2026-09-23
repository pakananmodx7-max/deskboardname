import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildStudentAnalyticsMetrics } from '@/services/student-analytics-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { StudentAnalyticsSnapshot } from '@/types/student-analytics'

import {
  buildStudentSummaryFilename,
  buildStudentSummaryModel,
  drawStudentSummary,
  exportStudentSummaryPng,
  MAX_TREND_POINTS,
  MISSING,
  parseGradeTotals,
  SUMMARY_HEIGHT,
  SUMMARY_SECTIONS,
  SUMMARY_WIDTH,
  type StudentSummaryInput,
  type SummaryCanvasContext,
} from './student-summary-export'

const page = readFileSync(new URL('../../pages/teacher/subjects/student-analytics-page.tsx', import.meta.url), 'utf-8')

// ==================================================
// Fixtures
// ==================================================

function snapshot(overrides: Partial<StudentAnalyticsSnapshot> = {}): StudentAnalyticsSnapshot {
  return {
    metrics: [
      { key: 'grade', label: 'ผลการเรียน', value: 90, classroomAverage: 75, rawLabel: '18.0/20.0 คะแนน (2 งานที่มีคะแนน)' },
      { key: 'completion', label: 'ส่งงานครบ', value: 100, classroomAverage: 80, rawLabel: '2/2 ชิ้น' },
      { key: 'onTime', label: 'ส่งงานตรงเวลา', value: 50, classroomAverage: 60, rawLabel: '1/2 ชิ้น' },
      { key: 'attendance', label: 'การเข้าเรียน', value: 87.5, classroomAverage: 90, rawLabel: '7/8 ครั้ง' },
    ],
    trend: [
      { assignmentId: 'a1', assignmentTitle: 'งานที่ 1 วันคืออะไร', dueDate: '2026-06-01', studentPercent: 100, classroomAveragePercent: 80 },
      { assignmentId: 'a2', assignmentTitle: 'แบบฝึกหัดที่ 2', dueDate: '2026-06-08', studentPercent: 80, classroomAveragePercent: null },
    ],
    attendance: { present: 7, late: 1, leave: 0, absent: 0, total: 8, attendanceRate: 87.5 },
    assignments: { totalAssignments: 2, submitted: 2, onTime: 1, late: 1, missing: 0 },
    evidence: [],
    classroomSize: 30,
    ...overrides,
  }
}

const EMPTY_SNAPSHOT: StudentAnalyticsSnapshot = {
  metrics: [
    { key: 'grade', label: 'ผลการเรียน', value: null, classroomAverage: null, rawLabel: null },
    { key: 'completion', label: 'ส่งงานครบ', value: null, classroomAverage: null, rawLabel: null },
    { key: 'onTime', label: 'ส่งงานตรงเวลา', value: null, classroomAverage: null, rawLabel: null },
    { key: 'attendance', label: 'การเข้าเรียน', value: null, classroomAverage: null, rawLabel: null },
  ],
  trend: [],
  attendance: { present: 0, late: 0, leave: 0, absent: 0, total: 0, attendanceRate: null },
  assignments: { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 },
  evidence: [],
  classroomSize: 1,
}

function input(overrides: Partial<StudentSummaryInput> = {}): StudentSummaryInput {
  return {
    student: { firstName: 'สมชาย', lastName: 'ใจดี', number: 1, studentCode: '12345' },
    subjectName: 'คณิตศาสตร์ ค21101',
    classroom: { name: 'ม.1/1', academicYear: '2569', semester: '1' },
    snapshot: snapshot(),
    generatedAt: new Date('2026-09-23T10:00:00+07:00'),
    ...overrides,
  }
}

/** Records every fillText with its position; measureText approximates
 * width so fitText/maxWidth logic runs as in a browser. */
function recordingContext() {
  const texts: { text: string; x: number; y: number; font: string }[] = []
  let currentFont = '400 16px sans-serif'
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    get font() {
      return currentFont
    },
    set font(value: string) {
      currentFont = value
    },
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    fillRect() {},
    strokeRect() {},
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, font: currentFont })
    },
    measureText(text: string) {
      // Thai above/below-base marks take no horizontal space.
      const size = Number(/(\d+)px/.exec(currentFont)?.[1] ?? 16)
      const advancing = Array.from(text).filter((ch) => !/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch)).length
      return { width: advancing * size * 0.55 } as TextMetrics
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    setLineDash() {},
    roundRect() {},
  } as unknown as SummaryCanvasContext
  return { ctx, texts, joined: () => texts.map((t) => t.text).join('\n') }
}

// ==================================================
// Tests
// ==================================================

describe('ดาวน์โหลดภาพสรุป — button on the existing Student Analytics page', () => {
  it('shows the export button in the top-right row, next to กลับไปรายชื่อนักเรียน', () => {
    const topRow = page.slice(page.indexOf('<div className="mb-2 flex flex-wrap items-center justify-between gap-2">'), page.indexOf('<div className="flex flex-wrap items-start justify-between gap-3">'))
    expect(topRow).toContain('กลับไปรายชื่อนักเรียน')
    expect(topRow).toContain("'ดาวน์โหลดภาพสรุป'")
    expect(topRow).toContain('onClick={() => void handleExportSummary()}')
    expect(topRow).toContain('disabled={!canExport}')
  })

  it('exports from the data already loaded — no new analytics query from the export path', () => {
    const handler = page.slice(page.indexOf('async function handleExportSummary'), page.indexOf('async function refreshNotes'))
    expect(handler).toContain('student: currentStudent')
    expect(handler).toContain('snapshot,')
    expect(handler).not.toMatch(/getStudentAnalyticsSnapshot|getStudentsByClassroom|supabase/)
    const module = readFileSync(new URL('./student-summary-export.ts', import.meta.url), 'utf-8')
    expect(module).not.toMatch(/from '@\/services\/|supabase|html2canvas|html-to-image|dom-to-image/)
  })
})

describe('filename', () => {
  it('is student-summary-{studentCode}-{studentName}.png', () => {
    expect(buildStudentSummaryFilename('12345', 'สมชาย', 'ใจดี')).toBe('student-summary-12345-สมชาย-ใจดี.png')
  })

  it('never produces an invalid filename (missing code, slashes, extra spaces)', () => {
    expect(buildStudentSummaryFilename(null, 'สมชาย', 'ใจดี')).toBe('student-summary-no-code-สมชาย-ใจดี.png')
    expect(buildStudentSummaryFilename(' 12/34 ', ' ด.ช.  สมชาย ', 'ใจ:ดี?')).toBe('student-summary-1234-ด.ช.-สมชาย-ใจดี.png')
    expect(buildStudentSummaryFilename('', '', '')).toBe('student-summary-no-code-student.png')
  })
})

describe('export uses the current student\'s real data', () => {
  it('model carries every required field', () => {
    const m = buildStudentSummaryModel(input())
    expect(m).toMatchObject({
      fullName: 'สมชาย ใจดี',
      number: '1',
      studentCode: '12345',
      subjectName: 'คณิตศาสตร์ ค21101',
      classroomName: 'ม.1/1',
      academicTerm: 'ปีการศึกษา 2569 / ภาคเรียนที่ 1',
      grade: { earned: '18', possible: '20', percent: '90%', gradedCount: '2' },
      classroomAverage: '75%',
      diffFromAverage: '+15%',
      diffTone: 'up',
      completion: { percent: '100%', raw: '2/2 ชิ้น', average: '80%' },
      onTime: { percent: '50%', raw: '1/2 ชิ้น', average: '60%' },
      attendance: { percent: '88%', raw: '7/8 ครั้ง', average: '90%' },
      work: { total: '2', submitted: '2', late: '1', missing: '0' },
    })
    expect(m.radar).toHaveLength(4)
    expect(m.trend.map((p) => p.title)).toEqual(['งานที่ 1 วันคืออะไร', 'แบบฝึกหัดที่ 2'])
    expect(m.generatedAt).toMatch(/2569|2026/)
  })

  it('the image contains the student, subject, classroom, key numbers, both charts and the report date', () => {
    const { ctx, joined } = recordingContext()
    drawStudentSummary(ctx, buildStudentSummaryModel(input()))
    const all = joined()
    for (const expected of [
      'สมชาย ใจดี',
      'เลขที่ 1',
      'รหัสนักเรียน 12345',
      'คณิตศาสตร์ ค21101',
      'ม.1/1',
      'ปีการศึกษา 2569 / ภาคเรียนที่ 1',
      'คะแนนที่ได้ / คะแนนเต็ม',
      '18 / 20',
      '90%',
      'ค่าเฉลี่ยห้อง',
      '+15%',
      'ส่งงานครบ',
      'ส่งงานตรงเวลา',
      'การเข้าเรียน',
      'งานทั้งหมด',
      'ส่งแล้ว',
      'ส่งช้า',
      'ขาดส่ง',
      'ภาพรวมหลายมิติ',
      'แนวโน้มผลการเรียน',
      'วันที่สร้างรายงาน',
    ]) {
      expect(all).toContain(expected)
    }
    // Never the page chrome.
    expect(all).not.toMatch(/คนก่อนหน้า|คนถัดไป|กลับไปรายชื่อนักเรียน/)
  })

  it('exportStudentSummaryPng renders the model of the given student and downloads under the right name', async () => {
    const rendered: string[] = []
    const downloads: string[] = []
    const filename = await exportStudentSummaryPng(input(), {
      render: async (model) => {
        rendered.push(model.fullName)
        return new Blob(['png'])
      },
      download: (_blob, name) => downloads.push(name),
    })
    expect(filename).toBe('student-summary-12345-สมชาย-ใจดี.png')
    expect(rendered).toEqual(['สมชาย ใจดี'])
    expect(downloads).toEqual([filename])
  })

  it('grade totals are read from the SAME figure the analytics service produces (no recalculation)', () => {
    const assignments = [
      { id: 'a1', maxScore: 10, dueDate: '2026-06-01', createdAt: '2026-05-01', isArchived: false },
      { id: 'a2', maxScore: 5, dueDate: '2026-06-08', createdAt: '2026-05-02', isArchived: false },
    ] as Assignment[]
    const subs: Record<string, Record<string, AssignmentSubmission>> = {
      a1: { s1: { studentId: 's1', status: 'submitted', score: 7.5, note: null } },
      a2: { s1: { studentId: 's1', status: 'submitted', score: 0, note: null } },
    }
    const grade = buildStudentAnalyticsMetrics('s1', ['s1'], assignments, subs, {}).find((m) => m.key === 'grade')!
    expect(parseGradeTotals(grade.rawLabel)).toEqual({ earned: 7.5, possible: 15, gradedCount: 2 })
    expect(parseGradeTotals(null)).toBeNull()
    expect(parseGradeTotals('something else')).toBeNull()
  })
})

describe('missing data', () => {
  it('shows "-" instead of crashing when the snapshot and profile are empty', () => {
    const m = buildStudentSummaryModel(
      input({
        student: { firstName: 'สมหญิง', lastName: '', number: null, studentCode: null },
        classroom: { name: 'ม.2/3', academicYear: null, semester: null },
        snapshot: EMPTY_SNAPSHOT,
      }),
    )
    expect(m).toMatchObject({
      fullName: 'สมหญิง',
      number: MISSING,
      studentCode: MISSING,
      academicTerm: MISSING,
      grade: { earned: MISSING, possible: MISSING, percent: MISSING, gradedCount: MISSING },
      classroomAverage: MISSING,
      diffFromAverage: MISSING,
      diffTone: 'neutral',
      attendance: { percent: MISSING, raw: MISSING, breakdown: 'ยังไม่มีข้อมูลการเช็คชื่อ' },
      work: { total: '0', submitted: '0', late: '0', missing: '0' },
    })
    const { ctx, joined } = recordingContext()
    expect(() => drawStudentSummary(ctx, m)).not.toThrow()
    expect(joined()).toContain('ยังไม่มีงานที่มีคะแนน')
    expect(joined()).not.toMatch(/NaN|undefined|null/)
  })

  it('survives a snapshot with no metrics at all', () => {
    const m = buildStudentSummaryModel(input({ snapshot: { ...EMPTY_SNAPSHOT, metrics: [] } }))
    const { ctx, joined } = recordingContext()
    expect(() => drawStudentSummary(ctx, m)).not.toThrow()
    expect(joined()).toContain('ข้อมูลไม่พอสำหรับแผนภูมิ')
  })
})

describe('switching student', () => {
  it('each export reflects the student passed at that moment — nothing is cached between calls', async () => {
    const names: string[] = []
    const render = async (model: ReturnType<typeof buildStudentSummaryModel>) => {
      names.push(`${model.fullName}|${model.grade.percent}`)
      return new Blob(['png'])
    }
    const a = await exportStudentSummaryPng(input(), { render, download: () => {} })
    const b = await exportStudentSummaryPng(
      input({
        student: { firstName: 'สมหญิง', lastName: 'รักเรียน', number: 2, studentCode: '67890' },
        snapshot: snapshot({ metrics: [{ key: 'grade', label: 'ผลการเรียน', value: 40, classroomAverage: 75, rawLabel: '8.0/20.0 คะแนน (2 งานที่มีคะแนน)' }] }),
      }),
      { render, download: () => {} },
    )
    expect(a).toBe('student-summary-12345-สมชาย-ใจดี.png')
    expect(b).toBe('student-summary-67890-สมหญิง-รักเรียน.png')
    expect(names).toEqual(['สมชาย ใจดี|90%', 'สมหญิง รักเรียน|40%'])
  })

  it('the page only enables export when the loaded snapshot belongs to the student in the URL', () => {
    const effect = page.slice(page.indexOf('useEffect(() => {'), page.indexOf('}, [subjectId, classroomId, studentId])'))
    expect(effect.indexOf('setSnapshot(snapshotResult)')).toBeLessThan(effect.indexOf('setSnapshotStudentId(studentId)'))
    expect(page).toContain('const canExport = snapshot !== null && snapshotStudentId === studentId && !exporting')
    expect(page).toContain('if (!snapshot || snapshotStudentId !== studentId || !currentStudent || !subject || !classroom) return')
  })
})

describe('layout', () => {
  it('is A4 portrait (≈1:1.414) with every section inside the page and none overlapping', () => {
    expect(SUMMARY_HEIGHT / SUMMARY_WIDTH).toBeCloseTo(Math.SQRT2, 2)
    const sections = Object.values(SUMMARY_SECTIONS)
    for (let i = 0; i < sections.length; i++) {
      expect(sections[i].y + sections[i].h).toBeLessThanOrEqual(SUMMARY_HEIGHT - 30)
      if (i > 0) expect(sections[i].y).toBeGreaterThanOrEqual(sections[i - 1].y + sections[i - 1].h)
    }
  })

  it('no text is drawn outside the image, even with long names and the maximum trend points', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      assignmentId: `a${i}`,
      assignmentTitle: `ใบงานที่ ${i + 1} การวิเคราะห์โจทย์ปัญหาเชิงประยุกต์ในชีวิตประจำวัน`,
      dueDate: null,
      studentPercent: (i * 7) % 101,
      classroomAveragePercent: i % 3 === 0 ? null : 60,
    }))
    const m = buildStudentSummaryModel(
      input({
        student: { firstName: 'ด.ช.สมชายผู้มีชื่อยาวมากเป็นพิเศษเพื่อทดสอบ', lastName: 'นามสกุลยาวมากเป็นพิเศษเช่นกัน', number: 45, studentCode: '1234567890' },
        subjectName: 'วิทยาศาสตร์และเทคโนโลยี (การออกแบบและเทคโนโลยี) ว21103',
        snapshot: snapshot({ trend: many }),
      }),
    )
    expect(m.trend).toHaveLength(MAX_TREND_POINTS)
    expect(m.trend[0].index).toBe(20 - MAX_TREND_POINTS + 1)
    const { ctx, texts } = recordingContext()
    drawStudentSummary(ctx, m)
    for (const t of texts) {
      expect(t.y).toBeGreaterThan(0)
      expect(t.y).toBeLessThan(SUMMARY_HEIGHT)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x).toBeLessThanOrEqual(SUMMARY_WIDTH)
    }
    expect(texts.some((t) => t.text.includes('แสดง 12 งานล่าสุดจาก 20 งาน'))).toBe(true)
  })

  it('draws Thai text with the app\'s Thai font first', () => {
    const { ctx, texts } = recordingContext()
    drawStudentSummary(ctx, buildStudentSummaryModel(input()))
    expect(texts.every((t) => t.font.includes('"Noto Sans Thai"'))).toBe(true)
  })
})
