import { DEMO_STUDENTS } from '@/demo/students'
import type { DemoGradeComponent, DemoGradeScores } from '@/demo/types'

export const GRADE_COMPONENTS: DemoGradeComponent[] = [
  { key: 'quiz1', label: 'Quiz 1', max: 20 },
  { key: 'quiz2', label: 'Quiz 2', max: 20 },
  { key: 'homework', label: 'Homework', max: 20 },
  { key: 'project', label: 'Project', max: 20 },
  { key: 'midterm', label: 'Midterm', max: 20 },
]

export const GRADE_TOTAL_MAX = GRADE_COMPONENTS.reduce((sum, c) => sum + c.max, 0)

export function computeTotal(scores: DemoGradeScores): number {
  return GRADE_COMPONENTS.reduce((sum, c) => sum + (scores[c.key] ?? 0), 0)
}

export function computeAverage(scores: DemoGradeScores): number {
  return computeTotal(scores) / GRADE_COMPONENTS.length
}

/** Small deterministic PRNG so the seed is stable across reloads within a session. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A few students are deliberately weaker, matching the "students requiring attention" narrative. */
const STRUGGLING_STUDENT_INDEXES = new Set([0, 1, 2, 6])

export function buildInitialGrades(): Record<string, DemoGradeScores> {
  const grades: Record<string, DemoGradeScores> = {}

  DEMO_STUDENTS.forEach((student, index) => {
    const rand = mulberry32(index + 1)
    const isStruggling = STRUGGLING_STUDENT_INDEXES.has(index)
    const [min, max] = isStruggling ? [8, 14] : [13, 20]

    const scores = {} as DemoGradeScores
    for (const component of GRADE_COMPONENTS) {
      const ratio = min / 20 + rand() * ((max - min) / 20)
      scores[component.key] = Math.round(ratio * component.max)
    }
    grades[student.id] = scores
  })

  return grades
}
