import { computeTotal } from '@/demo/grades'
import type {
  DemoAssignment,
  DemoAttendanceStatus,
  DemoGradeScores,
  DemoRiskLevel,
  DemoStudent,
} from '@/demo/types'

export interface AttendanceSummary {
  present: number
  late: number
  leave: number
  absent: number
  total: number
}

export function computeAttendanceSummary(
  attendance: Record<string, DemoAttendanceStatus>,
): AttendanceSummary {
  const summary: AttendanceSummary = { present: 0, late: 0, leave: 0, absent: 0, total: 0 }
  for (const status of Object.values(attendance)) {
    summary[status] += 1
    summary.total += 1
  }
  return summary
}

/** studentId -> number of assignments NOT submitted */
export function computeMissingCountByStudent(assignments: DemoAssignment[]): Record<string, number> {
  const missing: Record<string, number> = {}
  for (const assignment of assignments) {
    for (const [studentId, submitted] of Object.entries(assignment.submissions)) {
      if (!submitted) missing[studentId] = (missing[studentId] ?? 0) + 1
    }
  }
  return missing
}

export function countStudentsWithMissingWork(missingByStudent: Record<string, number>): number {
  return Object.values(missingByStudent).filter((count) => count > 0).length
}

export interface AtRiskStudent {
  student: DemoStudent
  riskLevel: DemoRiskLevel
  reasons: string[]
}

const RISK_SEVERITY: Record<DemoRiskLevel, number> = { low: 0, medium: 1, high: 2 }

function escalate(current: DemoRiskLevel, candidate: DemoRiskLevel): DemoRiskLevel {
  return RISK_SEVERITY[candidate] > RISK_SEVERITY[current] ? candidate : current
}

/** Returns every at-risk student, sorted most-severe first — callers slice for display as needed. */
export function computeAtRiskStudents(
  students: DemoStudent[],
  missingByStudent: Record<string, number>,
  grades: Record<string, DemoGradeScores>,
  attendance: Record<string, DemoAttendanceStatus>,
): AtRiskStudent[] {
  const results: AtRiskStudent[] = []

  for (const student of students) {
    const missing = missingByStudent[student.id] ?? 0
    const scores = grades[student.id]
    const total = scores ? computeTotal(scores) : null
    const isAbsentToday = attendance[student.id] === 'absent'

    const reasons: string[] = []
    let riskLevel: DemoRiskLevel = 'low'

    if (missing >= 3) {
      riskLevel = escalate(riskLevel, 'high')
      reasons.push(`งานค้าง ${missing} งาน`)
    } else if (missing === 2) {
      riskLevel = escalate(riskLevel, 'medium')
      reasons.push(`งานค้าง ${missing} งาน`)
    }

    if (total !== null && total < 55) {
      riskLevel = escalate(riskLevel, 'high')
      reasons.push('คะแนนเฉลี่ยต่ำกว่าเกณฑ์')
    } else if (total !== null && total < 65) {
      riskLevel = escalate(riskLevel, 'medium')
      reasons.push('คะแนนเฉลี่ยค่อนข้างต่ำ')
    }

    if (isAbsentToday) {
      riskLevel = escalate(riskLevel, 'medium')
      reasons.push('ขาดเรียนวันนี้')
    }

    if (riskLevel !== 'low') {
      results.push({ student, riskLevel, reasons })
    }
  }

  const severity: Record<DemoRiskLevel, number> = { high: 0, medium: 1, low: 2 }
  results.sort((a, b) => severity[a.riskLevel] - severity[b.riskLevel])

  return results
}

export interface GradeStats {
  classAverage: number
  highest: number
  lowest: number
}

export function computeGradeStats(
  students: DemoStudent[],
  grades: Record<string, DemoGradeScores>,
): GradeStats {
  const totals = students.map((student) => computeTotal(grades[student.id]))
  if (totals.length === 0) return { classAverage: 0, highest: 0, lowest: 0 }

  const sum = totals.reduce((a, b) => a + b, 0)
  return {
    classAverage: sum / totals.length,
    highest: Math.max(...totals),
    lowest: Math.min(...totals),
  }
}
