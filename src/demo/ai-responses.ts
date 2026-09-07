import { computeTotal } from '@/demo/grades'
import type { AtRiskStudent, AttendanceSummary, GradeStats } from '@/demo/selectors'
import type { DemoGradeScores, DemoStudent } from '@/demo/types'

export interface AiResponseContext {
  students: DemoStudent[]
  missingByStudent: Record<string, number>
  attendanceSummary: AttendanceSummary
  atRiskStudents: AtRiskStudent[]
  grades: Record<string, DemoGradeScores>
  gradeStats: GradeStats
}

export const AI_SUGGESTED_PROMPTS = [
  'ใครค้างงานเกิน 2 งาน',
  'สรุปการมาเรียนวันนี้',
  'ใครควรติดตาม',
  'สรุปคะแนนห้อง',
]

function studentName(student: DemoStudent): string {
  return `${student.firstName} ${student.lastName}`
}

function respondMissingWork(context: AiResponseContext): string {
  const names = context.students
    .filter((s) => (context.missingByStudent[s.id] ?? 0) > 2)
    .map((s) => `${studentName(s)} (${context.missingByStudent[s.id]} งาน)`)

  if (names.length === 0) {
    return 'ไม่มีนักเรียนที่ค้างงานเกิน 2 งานในขณะนี้ 🎉'
  }
  return `พบนักเรียนค้างงานเกิน 2 งาน ทั้งหมด ${names.length} คน:\n${names.map((n) => `• ${n}`).join('\n')}`
}

function respondAttendanceToday(context: AiResponseContext): string {
  const { present, late, leave, absent, total } = context.attendanceSummary
  const rate = total > 0 ? Math.round((present / total) * 100) : 0
  return [
    `สรุปการเข้าเรียนวันนี้ (${total} คน):`,
    `• มาเรียน ${present} คน (${rate}%)`,
    `• สาย ${late} คน`,
    `• ลา ${leave} คน`,
    `• ขาด ${absent} คน`,
  ].join('\n')
}

function respondAtRisk(context: AiResponseContext): string {
  if (context.atRiskStudents.length === 0) {
    return 'ตอนนี้ยังไม่มีนักเรียนที่เข้าเกณฑ์ต้องติดตามเป็นพิเศษ'
  }
  const lines = context.atRiskStudents.map(
    (item) => `• ${studentName(item.student)} — ${item.reasons.join(', ')} (${item.riskLevel === 'high' ? 'ควรติดตามด่วน' : 'ควรติดตาม'})`,
  )
  return `นักเรียนที่ควรติดตาม ${context.atRiskStudents.length} คน:\n${lines.join('\n')}`
}

function respondGradeSummary(context: AiResponseContext): string {
  const { classAverage, highest, lowest } = context.gradeStats
  return [
    `สรุปคะแนนห้อง (จากคะแนนรวม เต็ม 100):`,
    `• คะแนนเฉลี่ยห้อง ${classAverage.toFixed(1)}`,
    `• คะแนนสูงสุด ${highest.toFixed(0)}`,
    `• คะแนนต่ำสุด ${lowest.toFixed(0)}`,
  ].join('\n')
}

function respondStudentLookup(context: AiResponseContext, query: string): string | null {
  const match = context.students.find(
    (s) => query.includes(s.firstName) || query.includes(s.nickname),
  )
  if (!match) return null

  const scores = context.grades[match.id]
  const total = scores ? computeTotal(scores) : 0
  const missing = context.missingByStudent[match.id] ?? 0
  return [
    `ข้อมูลของ ${studentName(match)} (${match.nickname}):`,
    `• รหัสนักเรียน ${match.studentCode}`,
    `• งานค้าง ${missing} งาน`,
    `• คะแนนรวม ${total}/100`,
  ].join('\n')
}

/**
 * Deterministic, fully local "AI" response generator — pattern-matches
 * the prompt against known intents and formats an answer from live demo
 * data. No LLM call. This exists purely to demonstrate the future
 * Hermes/LLM UX with realistic, data-grounded answers.
 */
export function getDemoAiResponse(prompt: string, context: AiResponseContext): string {
  const normalized = prompt.trim()

  const studentAnswer = respondStudentLookup(context, normalized)
  if (studentAnswer) return studentAnswer

  if (/ค้างงาน|ยังไม่ส่ง|missing/i.test(normalized)) {
    return respondMissingWork(context)
  }
  if (/มาเรียน|เข้าเรียน|attendance/i.test(normalized)) {
    return respondAttendanceToday(context)
  }
  if (/ติดตาม|เสี่ยง|risk/i.test(normalized)) {
    return respondAtRisk(context)
  }
  if (/คะแนน|เกรด|grade/i.test(normalized)) {
    return respondGradeSummary(context)
  }

  return 'ขออภัย ฟีเจอร์นี้ยังอยู่ระหว่างการพัฒนา (เดโม) ลองถามคำถามตัวอย่างด้านล่างได้เลย'
}
