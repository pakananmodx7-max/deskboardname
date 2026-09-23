import { radarAxisAngle } from '@/components/charts/radar-chart'
import type { StudentAnalyticsMetric, StudentAnalyticsMetricKey, StudentAnalyticsSnapshot } from '@/types/student-analytics'

/**
 * "ดาวน์โหลดภาพสรุป" — a one-page PNG summary of ONE student, drawn
 * directly with the browser's Canvas 2D API (no screenshot library, no
 * new dependency, and never a capture of the page itself — so the
 * sidebar, navbar and the previous/next switcher can never end up in the
 * image). Every number comes from the StudentAnalyticsSnapshot the page
 * has ALREADY loaded for the student currently open; nothing here
 * queries or recalculates analytics.
 *
 * Split in three so each part is testable without a browser:
 *   buildStudentSummaryModel  — pure: snapshot + context -> display strings ("-" when missing)
 *   drawStudentSummary        — draws a model onto any Canvas-2D-like context
 *   exportStudentSummaryPng   — browser glue: fonts, canvas, PNG blob, download
 */

// ==================================================
// Layout + theme
// ==================================================

/** A4 portrait at 150 dpi (1 : 1.414) — sharp enough for LINE and for
 * printing on A4 without scaling artifacts. */
export const SUMMARY_WIDTH = 1240
export const SUMMARY_HEIGHT = 1754

const MARGIN = 60
const CONTENT_WIDTH = SUMMARY_WIDTH - MARGIN * 2

/** Vertical layout (y, height) of each section — kept together so the
 * "nothing overflows the page" test can check them. */
export const SUMMARY_SECTIONS = {
  header: { y: 0, h: 280 },
  grade: { y: 300, h: 170 },
  rates: { y: 488, h: 150 },
  work: { y: 656, h: 110 },
  charts: { y: 784, h: 520 },
  trend: { y: 1322, h: 392 },
} as const
const GRADE_ROW_Y = SUMMARY_SECTIONS.grade.y
const GRADE_ROW_H = SUMMARY_SECTIONS.grade.h
const RATE_ROW_Y = SUMMARY_SECTIONS.rates.y
const RATE_ROW_H = SUMMARY_SECTIONS.rates.h
const WORK_ROW_Y = SUMMARY_SECTIONS.work.y
const WORK_ROW_H = SUMMARY_SECTIONS.work.h
const CHART_ROW_Y = SUMMARY_SECTIONS.charts.y
const CHART_ROW_H = SUMMARY_SECTIONS.charts.h
const TREND_Y = SUMMARY_SECTIONS.trend.y
const TREND_H = SUMMARY_SECTIONS.trend.h
const RADAR_RADIUS = 120
const RADAR_SIDE_LABEL_OFFSET = 182
const RADAR_LABEL_MAX_WIDTH = 118
const FONT_FAMILY = '"Noto Sans Thai", "Inter", "Leelawadee UI", "Tahoma", sans-serif'

/** KrunameClass light-theme tokens (src/index.css oklch values, as hex —
 * canvas colors must not depend on the viewer's dark mode). */
const COLOR = {
  background: '#ffffff',
  panel: '#f0f4f8',
  primary: '#237fc8',
  primarySoft: '#e8eff6',
  foreground: '#0f171f',
  muted: '#5b656e',
  border: '#dbe2e9',
  success: '#4ca167',
  destructive: '#d5575b',
  warning: '#b7791f',
  average: '#8a949d',
} as const

export const MISSING = '-'

// ==================================================
// Model (pure)
// ==================================================

export interface StudentSummaryStudent {
  firstName: string
  lastName: string
  number: number | null
  studentCode: string | null
}

export interface StudentSummaryClassroom {
  name: string
  academicYear: string | null
  semester: string | null
}

export interface StudentSummaryInput {
  student: StudentSummaryStudent
  subjectName: string
  classroom: StudentSummaryClassroom
  snapshot: StudentAnalyticsSnapshot
  generatedAt: Date
}

export interface StudentSummaryMetricRow {
  key: StudentAnalyticsMetricKey
  label: string
  value: string
  average: string
  diff: string
  raw: string
}

export interface StudentSummaryModel {
  fullName: string
  number: string
  studentCode: string
  subjectName: string
  classroomName: string
  academicTerm: string
  generatedAt: string
  grade: { earned: string; possible: string; percent: string; gradedCount: string }
  classroomAverage: string
  diffFromAverage: string
  diffTone: 'up' | 'down' | 'neutral'
  completion: { percent: string; raw: string; average: string }
  onTime: { percent: string; raw: string; average: string }
  attendance: { percent: string; raw: string; average: string; breakdown: string }
  work: { total: string; submitted: string; late: string; missing: string }
  metrics: StudentSummaryMetricRow[]
  radar: { label: string; student: number | null; average: number | null }[]
  classroomSize: number
  trend: { index: number; title: string; student: number; average: number | null }[]
  trendTotal: number
}

/** The newest points the trend panel can show legibly (numbered markers +
 * a 3-column title list). Older points are summarized in a note. */
export const MAX_TREND_POINTS = 12

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? MISSING : `${Math.round(value)}%`
}

function formatDiff(value: number | null, average: number | null): string {
  if (value === null || average === null) return MISSING
  const diff = Math.round(value - average)
  return `${diff > 0 ? '+' : ''}${diff}%`
}

/**
 * The grade dimension's raw figure is produced by
 * buildStudentAnalyticsMetrics as "{earned}/{possible} คะแนน ({n} งานที่มีคะแนน)"
 * — read back here so the image shows the SAME numbers the page shows,
 * without re-deriving them. Anything else -> null (shown as "-").
 */
export function parseGradeTotals(rawLabel: string | null): { earned: number; possible: number; gradedCount: number | null } | null {
  if (!rawLabel) return null
  const match = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) คะแนน(?: \((\d+) งานที่มีคะแนน\))?/.exec(rawLabel)
  if (!match) return null
  return { earned: Number(match[1]), possible: Number(match[2]), gradedCount: match[3] ? Number(match[3]) : null }
}

function metricOf(snapshot: StudentAnalyticsSnapshot, key: StudentAnalyticsMetricKey): StudentAnalyticsMetric | null {
  return snapshot.metrics.find((m) => m.key === key) ?? null
}

export function formatThaiDate(date: Date): string {
  try {
    return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function buildStudentSummaryModel(input: StudentSummaryInput): StudentSummaryModel {
  const { student, subjectName, classroom, snapshot, generatedAt } = input
  const fullName = `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || MISSING

  const grade = metricOf(snapshot, 'grade')
  const gradeTotals = parseGradeTotals(grade?.rawLabel ?? null)
  const completion = metricOf(snapshot, 'completion')
  const onTime = metricOf(snapshot, 'onTime')
  const attendance = metricOf(snapshot, 'attendance')

  const gradeValue = grade?.value ?? null
  const gradeAverage = grade?.classroomAverage ?? null
  const diff = gradeValue !== null && gradeAverage !== null ? Math.round(gradeValue - gradeAverage) : null

  const termParts = [
    classroom.academicYear ? `ปีการศึกษา ${classroom.academicYear}` : null,
    classroom.semester ? `ภาคเรียนที่ ${classroom.semester}` : null,
  ].filter(Boolean)

  const att = snapshot.attendance
  const allTrend = snapshot.trend.map((p, i) => ({
    index: i + 1,
    title: p.assignmentTitle || MISSING,
    student: p.studentPercent,
    average: p.classroomAveragePercent,
  }))

  return {
    fullName,
    number: student.number !== null && student.number !== undefined ? String(student.number) : MISSING,
    studentCode: student.studentCode?.trim() || MISSING,
    subjectName: subjectName?.trim() || MISSING,
    classroomName: classroom.name?.trim() || MISSING,
    academicTerm: termParts.length > 0 ? termParts.join(' / ') : MISSING,
    generatedAt: formatThaiDate(generatedAt),
    grade: {
      earned: gradeTotals ? formatNumber(gradeTotals.earned) : MISSING,
      possible: gradeTotals ? formatNumber(gradeTotals.possible) : MISSING,
      percent: formatPercent(gradeValue),
      gradedCount: gradeTotals?.gradedCount !== null && gradeTotals?.gradedCount !== undefined ? String(gradeTotals.gradedCount) : MISSING,
    },
    classroomAverage: formatPercent(gradeAverage),
    diffFromAverage: formatDiff(gradeValue, gradeAverage),
    diffTone: diff === null || diff === 0 ? 'neutral' : diff > 0 ? 'up' : 'down',
    completion: { percent: formatPercent(completion?.value), raw: completion?.rawLabel ?? MISSING, average: formatPercent(completion?.classroomAverage) },
    onTime: { percent: formatPercent(onTime?.value), raw: onTime?.rawLabel ?? MISSING, average: formatPercent(onTime?.classroomAverage) },
    attendance: {
      percent: formatPercent(attendance?.value ?? att.attendanceRate),
      raw: attendance?.rawLabel ?? (att.total > 0 ? `${att.present}/${att.total} ครั้ง` : MISSING),
      average: formatPercent(attendance?.classroomAverage),
      breakdown: att.total > 0 ? `มา ${att.present} · สาย ${att.late} · ลา ${att.leave} · ขาด ${att.absent}` : 'ยังไม่มีข้อมูลการเช็คชื่อ',
    },
    work: {
      total: String(snapshot.assignments.totalAssignments),
      submitted: String(snapshot.assignments.submitted),
      late: String(snapshot.assignments.late),
      missing: String(snapshot.assignments.missing),
    },
    metrics: snapshot.metrics.map((m) => ({
      key: m.key,
      label: m.label,
      value: formatPercent(m.value),
      average: formatPercent(m.classroomAverage),
      diff: formatDiff(m.value, m.classroomAverage),
      raw: m.rawLabel ?? MISSING,
    })),
    radar: snapshot.metrics.map((m) => ({ label: m.label, student: m.value, average: m.classroomAverage })),
    classroomSize: snapshot.classroomSize,
    trend: allTrend.slice(-MAX_TREND_POINTS),
    trendTotal: allTrend.length,
  }
}

/** student-summary-{studentCode}-{studentName}.png — Thai kept as-is,
 * whitespace -> "-", characters no OS accepts in a filename removed. */
export function buildStudentSummaryFilename(studentCode: string | null, firstName: string, lastName: string): string {
  const clean = (value: string) =>
    Array.from(value.normalize('NFC'))
      .filter((ch) => ch.charCodeAt(0) >= 0x20)
      .join('')
      .replace(/[\\/:*?"<>|#%]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  const code = clean(studentCode ?? '') || 'no-code'
  const name = clean(`${firstName ?? ''} ${lastName ?? ''}`) || 'student'
  return `student-summary-${code}-${name}.png`
}

// ==================================================
// Drawing
// ==================================================

/** The subset of CanvasRenderingContext2D this module uses — lets tests
 * pass a recording stub instead of a real canvas. */
export type SummaryCanvasContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'fillRect'
  | 'strokeRect'
  | 'fillText'
  | 'measureText'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'setLineDash'
> & { roundRect?: CanvasRenderingContext2D['roundRect'] }

function font(size: number, weight: 400 | 500 | 600 | 700 = 400): string {
  return `${weight} ${size}px ${FONT_FAMILY}`
}

/** Truncates with "…" so a long Thai subject/assignment name never runs
 * outside its box. */
export function fitText(ctx: SummaryCanvasContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  const chars = Array.from(text)
  while (chars.length > 0 && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop()
  return chars.length > 0 ? `${chars.join('')}…` : '…'
}

function text(
  ctx: SummaryCanvasContext,
  value: string,
  x: number,
  y: number,
  options: { size: number; weight?: 400 | 500 | 600 | 700; color?: string; align?: CanvasTextAlign; maxWidth?: number },
) {
  ctx.font = font(options.size, options.weight)
  ctx.fillStyle = options.color ?? COLOR.foreground
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(options.maxWidth ? fitText(ctx, value, options.maxWidth) : value, x, y)
}

function panel(ctx: SummaryCanvasContext, x: number, y: number, w: number, h: number, fill: string = COLOR.panel) {
  ctx.fillStyle = fill
  ctx.beginPath()
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, 18)
  } else {
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x, y + h)
    ctx.closePath()
  }
  ctx.fill()
}

function toneColor(tone: StudentSummaryModel['diffTone']): string {
  return tone === 'up' ? COLOR.success : tone === 'down' ? COLOR.destructive : COLOR.foreground
}

function drawHeader(ctx: SummaryCanvasContext, m: StudentSummaryModel) {
  text(ctx, 'KrunameClass', MARGIN, 88, { size: 24, weight: 700, color: COLOR.primary })
  text(ctx, 'รายงานสรุปผลนักเรียนรายบุคคล', MARGIN + 190, 88, { size: 22, color: COLOR.muted })
  text(ctx, `วันที่สร้างรายงาน ${m.generatedAt}`, SUMMARY_WIDTH - MARGIN, 88, { size: 20, color: COLOR.muted, align: 'right' })

  text(ctx, m.fullName, MARGIN, 160, { size: 50, weight: 700, maxWidth: CONTENT_WIDTH })
  text(ctx, `เลขที่ ${m.number}   ·   รหัสนักเรียน ${m.studentCode}`, MARGIN, 208, { size: 26, weight: 500 })
  text(ctx, `รายวิชา ${m.subjectName}   ·   ห้อง ${m.classroomName}   ·   ${m.academicTerm === MISSING ? 'ปีการศึกษา / ภาคเรียน -' : m.academicTerm}`, MARGIN, 250, {
    size: 23,
    color: COLOR.muted,
    maxWidth: CONTENT_WIDTH,
  })

  ctx.fillStyle = COLOR.primary
  ctx.fillRect(MARGIN, 276, CONTENT_WIDTH, 4)
}

function drawGradeRow(ctx: SummaryCanvasContext, m: StudentSummaryModel) {
  const y = GRADE_ROW_Y
  const h = GRADE_ROW_H
  // ผลการเรียน — the headline number.
  panel(ctx, MARGIN, y, 500, h, COLOR.primarySoft)
  text(ctx, 'ผลการเรียน', MARGIN + 28, y + 46, { size: 24, weight: 600, color: COLOR.primary })
  text(ctx, m.grade.percent, MARGIN + 28, y + 128, { size: 76, weight: 700, color: COLOR.primary, maxWidth: 210 })
  text(ctx, 'คะแนนที่ได้ / คะแนนเต็ม', MARGIN + 250, y + 82, { size: 18, color: COLOR.muted, maxWidth: 230 })
  text(ctx, `${m.grade.earned} / ${m.grade.possible}`, MARGIN + 250, y + 120, { size: 34, weight: 700, maxWidth: 230 })
  text(ctx, m.grade.gradedCount === MISSING ? 'ยังไม่มีงานที่มีคะแนน' : `จาก ${m.grade.gradedCount} งานที่มีคะแนน`, MARGIN + 250, y + 150, {
    size: 18,
    color: COLOR.muted,
    maxWidth: 230,
  })

  const w = (CONTENT_WIDTH - 500 - 40) / 2
  const avgX = MARGIN + 520
  panel(ctx, avgX, y, w, h)
  text(ctx, 'ค่าเฉลี่ยห้อง', avgX + 28, y + 46, { size: 24, weight: 600, color: COLOR.muted })
  text(ctx, m.classroomAverage, avgX + 28, y + 122, { size: 64, weight: 700 })
  text(ctx, `จาก ${m.classroomSize} คนในห้อง`, avgX + 28, y + 154, { size: 20, color: COLOR.muted })

  const diffX = avgX + w + 20
  panel(ctx, diffX, y, w, h)
  text(ctx, 'ส่วนต่างจากค่าเฉลี่ยห้อง', diffX + 28, y + 46, { size: 21, weight: 600, color: COLOR.muted, maxWidth: w - 56 })
  text(ctx, m.diffFromAverage, diffX + 28, y + 122, { size: 64, weight: 700, color: toneColor(m.diffTone) })
  const diffNote =
    m.diffFromAverage === MISSING
      ? 'ยังไม่มีข้อมูลเทียบ'
      : m.diffTone === 'up'
        ? 'สูงกว่าค่าเฉลี่ยห้อง'
        : m.diffTone === 'down'
          ? 'ต่ำกว่าค่าเฉลี่ยห้อง'
          : 'เท่ากับค่าเฉลี่ยห้อง'
  text(ctx, diffNote, diffX + 28, y + 154, {
    size: 20,
    color: COLOR.muted,
  })
}

function drawRateRow(ctx: SummaryCanvasContext, m: StudentSummaryModel) {
  const y = RATE_ROW_Y
  const h = RATE_ROW_H
  const w = (CONTENT_WIDTH - 40) / 3
  const cards = [
    { label: 'ส่งงานครบ', data: m.completion, extra: m.completion.raw },
    { label: 'ส่งงานตรงเวลา', data: m.onTime, extra: m.onTime.raw },
    { label: 'การเข้าเรียน', data: m.attendance, extra: m.attendance.breakdown },
  ]
  cards.forEach((card, i) => {
    const x = MARGIN + i * (w + 20)
    panel(ctx, x, y, w, h)
    text(ctx, card.label, x + 24, y + 42, { size: 23, weight: 600, color: COLOR.muted })
    text(ctx, card.data.percent, x + 24, y + 100, { size: 52, weight: 700 })
    text(ctx, `ห้องเฉลี่ย ${card.data.average}`, x + w - 24, y + 96, { size: 20, color: COLOR.muted, align: 'right' })
    text(ctx, card.extra, x + 24, y + 132, { size: 19, color: COLOR.muted, maxWidth: w - 48 })
  })
}

function drawWorkRow(ctx: SummaryCanvasContext, m: StudentSummaryModel) {
  const y = WORK_ROW_Y
  const h = WORK_ROW_H
  panel(ctx, MARGIN, y, CONTENT_WIDTH, h)
  text(ctx, 'สรุปงาน', MARGIN + 28, y + 64, { size: 26, weight: 700 })
  const items = [
    { label: 'งานทั้งหมด', value: m.work.total, color: COLOR.foreground },
    { label: 'ส่งแล้ว', value: m.work.submitted, color: COLOR.success },
    { label: 'ส่งช้า', value: m.work.late, color: COLOR.warning },
    { label: 'ขาดส่ง', value: m.work.missing, color: COLOR.destructive },
  ]
  const startX = MARGIN + 200
  const colW = (CONTENT_WIDTH - 200) / items.length
  items.forEach((item, i) => {
    const cx = startX + i * colW + colW / 2
    text(ctx, item.value, cx, y + 60, { size: 44, weight: 700, color: item.color, align: 'center' })
    text(ctx, item.label, cx, y + 92, { size: 20, color: COLOR.muted, align: 'center' })
  })
}

function drawRadar(ctx: SummaryCanvasContext, m: StudentSummaryModel, x: number, y: number, w: number, h: number) {
  panel(ctx, x, y, w, h)
  text(ctx, 'ภาพรวมหลายมิติ', x + 28, y + 48, { size: 26, weight: 700 })

  const cx = x + w / 2
  const cy = y + 260
  const radius = RADAR_RADIUS
  const total = m.radar.length
  if (total < 3) {
    text(ctx, 'ข้อมูลไม่พอสำหรับแผนภูมิ', cx, cy, { size: 22, color: COLOR.muted, align: 'center' })
    return
  }
  const point = (value: number | null, i: number, r = radius) => {
    const clamped = value === null ? 0 : Math.max(0, Math.min(100, value))
    const angle = radarAxisAngle(i, total)
    const rr = (clamped / 100) * r
    return { x: cx + rr * Math.cos(angle), y: cy + rr * Math.sin(angle) }
  }

  ctx.strokeStyle = COLOR.border
  ctx.lineWidth = 1.5
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath()
    for (let i = 0; i < total; i++) {
      const p = point(ring * 25, i)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.stroke()
  }
  for (let i = 0; i < total; i++) {
    const p = point(100, i)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function polygon(values: (number | null)[], color: string, fillAlpha: number, lineWidth: number, dashed: boolean) {
    ctx.beginPath()
    values.forEach((v, i) => {
      const p = point(v, i)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.save()
    ctx.globalAlpha = fillAlpha
    ctx.fillStyle = color
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.setLineDash(dashed ? [8, 6] : [])
    ctx.stroke()
    ctx.setLineDash([])
  }
  polygon(m.radar.map((a) => a.average), COLOR.average, 0.15, 2, true)
  polygon(m.radar.map((a) => a.student), COLOR.primary, 0.25, 3, false)

  // Labels are centered blocks (name + this student's %) placed so they
  // always stay inside the panel: above/below for vertical axes, beside
  // (at RADAR_SIDE_LABEL_OFFSET from the center) for the others.
  m.radar.forEach((axis, i) => {
    const p = point(100, i)
    let lx = p.x
    let ly: number
    let maxWidth = RADAR_LABEL_MAX_WIDTH
    if (Math.abs(p.x - cx) < 10) {
      ly = p.y < cy ? p.y - 40 : p.y + 30
      maxWidth = w - 56
    } else {
      lx = cx + Math.sign(p.x - cx) * RADAR_SIDE_LABEL_OFFSET
      ly = p.y - 6
    }
    text(ctx, axis.label, lx, ly, { size: 20, weight: 600, align: 'center', maxWidth })
    text(ctx, formatPercent(axis.student), lx, ly + 24, { size: 19, weight: 600, color: COLOR.primary, align: 'center' })
  })

  drawLegend(ctx, x + 28, y + h - 28, `ค่าเฉลี่ยห้อง (${m.classroomSize} คน)`)
}

function drawLegend(ctx: SummaryCanvasContext, x: number, y: number, averageLabel: string) {
  ctx.fillStyle = COLOR.primary
  ctx.fillRect(x, y - 12, 26, 6)
  text(ctx, 'นักเรียนคนนี้', x + 36, y, { size: 19 })
  ctx.fillStyle = COLOR.average
  ctx.fillRect(x + 190, y - 12, 26, 6)
  text(ctx, averageLabel, x + 226, y, { size: 19, color: COLOR.muted })
}

function drawComparison(ctx: SummaryCanvasContext, m: StudentSummaryModel, x: number, y: number, w: number, h: number) {
  panel(ctx, x, y, w, h)
  text(ctx, 'เทียบกับค่าเฉลี่ยห้อง', x + 28, y + 48, { size: 26, weight: 700 })
  const cols = [x + 28, x + w - 300, x + w - 170, x + w - 28]
  const headY = y + 100
  text(ctx, 'มิติ', cols[0], headY, { size: 19, weight: 600, color: COLOR.muted })
  text(ctx, 'นักเรียน', cols[1], headY, { size: 19, weight: 600, color: COLOR.muted, align: 'right' })
  text(ctx, 'ค่าเฉลี่ยห้อง', cols[2], headY, { size: 19, weight: 600, color: COLOR.muted, align: 'right' })
  text(ctx, 'ส่วนต่าง', cols[3], headY, { size: 19, weight: 600, color: COLOR.muted, align: 'right' })
  ctx.fillStyle = COLOR.border
  ctx.fillRect(x + 28, headY + 14, w - 56, 2)

  if (m.metrics.length === 0) {
    text(ctx, MISSING, cols[0], headY + 60, { size: 22 })
  }
  m.metrics.forEach((row, i) => {
    const rowY = headY + 62 + i * 76
    text(ctx, row.label, cols[0], rowY, { size: 23, weight: 600, maxWidth: cols[1] - cols[0] - 80 })
    text(ctx, row.raw, cols[0], rowY + 28, { size: 17, color: COLOR.muted, maxWidth: w - 56 })
    text(ctx, row.value, cols[1], rowY, { size: 24, weight: 700, align: 'right' })
    text(ctx, row.average, cols[2], rowY, { size: 22, color: COLOR.muted, align: 'right' })
    const tone = row.diff.startsWith('+') ? COLOR.success : row.diff.startsWith('-') && row.diff !== MISSING ? COLOR.destructive : COLOR.foreground
    text(ctx, row.diff, cols[3], rowY, { size: 22, weight: 600, color: tone, align: 'right' })
  })
}

function drawTrend(ctx: SummaryCanvasContext, m: StudentSummaryModel, x: number, y: number, w: number, h: number) {
  panel(ctx, x, y, w, h)
  text(ctx, 'แนวโน้มผลการเรียน', x + 28, y + 48, { size: 26, weight: 700 })
  if (m.trend.length === 0) {
    text(ctx, 'ยังไม่มีงานที่มีคะแนน', x + w / 2, y + h / 2, { size: 22, color: COLOR.muted, align: 'center' })
    return
  }
  drawLegend(ctx, x + w - 440, y + 46, 'ค่าเฉลี่ยห้อง')
  if (m.trendTotal > m.trend.length) {
    text(ctx, `แสดง ${m.trend.length} งานล่าสุดจาก ${m.trendTotal} งาน`, x + 28, y + 78, { size: 18, color: COLOR.muted })
  }

  const plotX = x + 90
  const plotY = y + 104
  const plotW = w - 130
  const plotH = 140
  const px = (i: number) => (m.trend.length <= 1 ? plotX + plotW / 2 : plotX + (i / (m.trend.length - 1)) * plotW)
  const py = (v: number) => plotY + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH

  ctx.lineWidth = 1
  for (const v of [0, 50, 100]) {
    ctx.fillStyle = COLOR.border
    ctx.fillRect(plotX, py(v), plotW, 1.5)
    text(ctx, `${v}%`, plotX - 14, py(v) + 7, { size: 17, color: COLOR.muted, align: 'right' })
  }

  function series(values: (number | null)[], color: string, width: number, dashed: boolean) {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.setLineDash(dashed ? [8, 6] : [])
    let open = false
    ctx.beginPath()
    values.forEach((v, i) => {
      if (v === null) {
        open = false
        return
      }
      if (!open) ctx.moveTo(px(i), py(v))
      else ctx.lineTo(px(i), py(v))
      open = true
    })
    ctx.stroke()
    ctx.setLineDash([])
  }
  series(m.trend.map((p) => p.average), COLOR.average, 2.5, true)
  series(m.trend.map((p) => p.student), COLOR.primary, 3.5, false)
  m.trend.forEach((p, i) => {
    ctx.fillStyle = COLOR.primary
    ctx.beginPath()
    ctx.arc(px(i), py(p.student), 6, 0, Math.PI * 2)
    ctx.fill()
    text(ctx, String(p.index), px(i), plotY + plotH + 26, { size: 17, color: COLOR.muted, align: 'center' })
  })

  // Numbered titles, 3 columns x 4 rows — the full names never overlap the chart.
  const listY = plotY + plotH + 62
  const colW = (w - 56) / 3
  m.trend.forEach((p, i) => {
    const col = Math.floor(i / 4)
    const row = i % 4
    const tx = x + 28 + col * colW
    const ty = listY + row * 25
    text(ctx, `${p.index}. ${p.title}`, tx, ty, { size: 18, maxWidth: colW - 80 })
    text(ctx, formatPercent(p.student), tx + colW - 16, ty, { size: 18, weight: 600, color: COLOR.primary, align: 'right' })
  })
}

/** Draws the whole summary. Pure with respect to its inputs: the only
 * side effects are calls on `ctx`. */
export function drawStudentSummary(ctx: SummaryCanvasContext, m: StudentSummaryModel): void {
  ctx.fillStyle = COLOR.background
  ctx.fillRect(0, 0, SUMMARY_WIDTH, SUMMARY_HEIGHT)

  drawHeader(ctx, m)
  drawGradeRow(ctx, m)
  drawRateRow(ctx, m)
  drawWorkRow(ctx, m)
  drawRadar(ctx, m, MARGIN, CHART_ROW_Y, 540, CHART_ROW_H)
  drawComparison(ctx, m, MARGIN + 560, CHART_ROW_Y, CONTENT_WIDTH - 560, CHART_ROW_H)
  drawTrend(ctx, m, MARGIN, TREND_Y, CONTENT_WIDTH, TREND_H)

  text(ctx, `ข้อมูลจาก KrunameClass · สร้างเมื่อ ${m.generatedAt}`, SUMMARY_WIDTH / 2, SUMMARY_HEIGHT - 26, {
    size: 17,
    color: COLOR.muted,
    align: 'center',
  })
}

// ==================================================
// Browser glue
// ==================================================

async function ensureFontsLoaded(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts) return
  try {
    await Promise.all([fonts.load(font(24, 400)), fonts.load(font(24, 600)), fonts.load(font(24, 700))])
    await fonts.ready
  } catch {
    // Falls back to the OS Thai font (Leelawadee UI / Tahoma / system) — never blocks the export.
  }
}

export async function renderStudentSummaryPng(model: StudentSummaryModel): Promise<Blob> {
  await ensureFontsLoaded()
  const canvas = document.createElement('canvas')
  canvas.width = SUMMARY_WIDTH
  canvas.height = SUMMARY_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับการสร้างภาพ')
  drawStudentSummary(ctx, model)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('สร้างไฟล์ภาพไม่สำเร็จ'))), 'image/png')
  })
}

function downloadPng(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Builds, draws and downloads the PNG for exactly the input given — the
 * page passes the student/snapshot it is showing at click time. Returns
 * the filename used. */
export async function exportStudentSummaryPng(
  input: StudentSummaryInput,
  deps: { render?: (model: StudentSummaryModel) => Promise<Blob>; download?: (blob: Blob, filename: string) => void } = {},
): Promise<string> {
  const model = buildStudentSummaryModel(input)
  const filename = buildStudentSummaryFilename(input.student.studentCode, input.student.firstName, input.student.lastName)
  const blob = await (deps.render ?? renderStudentSummaryPng)(model)
  ;(deps.download ?? downloadPng)(blob, filename)
  return filename
}
