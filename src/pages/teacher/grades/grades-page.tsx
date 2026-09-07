import { Card, CardContent } from '@/components/ui/card'
import { GRADE_COMPONENTS, GRADE_TOTAL_MAX, computeAverage, computeTotal } from '@/demo/grades'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoGradeScores } from '@/demo/types'

export function GradesPage() {
  const { classroomName, students, grades, gradeStats, updateGradeScore } = useDemoClassroom()

  function handleScoreChange(studentId: string, key: keyof DemoGradeScores, raw: string, max: number) {
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) return
    const clamped = Math.max(0, Math.min(max, parsed))
    updateGradeScore(studentId, key, clamped)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">คะแนนและเกรด</h1>
        <p className="mt-1 text-sm text-muted-foreground">{classroomName} · แก้ไขคะแนนได้โดยตรงในตาราง (เดโม)</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">คะแนนเฉลี่ยห้อง</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight">
              {gradeStats.classAverage.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground">/{GRADE_TOTAL_MAX}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">คะแนนสูงสุด</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-success">
              {gradeStats.highest.toFixed(0)}
              <span className="text-sm font-normal text-muted-foreground">/{GRADE_TOTAL_MAX}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">คะแนนต่ำสุด</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-destructive">
              {gradeStats.lowest.toFixed(0)}
              <span className="text-sm font-normal text-muted-foreground">/{GRADE_TOTAL_MAX}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="sticky left-0 bg-card px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  {GRADE_COMPONENTS.map((component) => (
                    <th key={component.key} className="px-3 py-3 text-center font-medium">
                      {component.label}
                      <div className="font-normal">/{component.max}</div>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center font-medium">Total</th>
                  <th className="px-3 py-3 text-center font-medium">Average</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const scores = grades[student.id]
                  const total = scores ? computeTotal(scores) : 0
                  const average = scores ? computeAverage(scores) : 0
                  return (
                    <tr key={student.id} className="border-b border-border last:border-0">
                      <td className="sticky left-0 whitespace-nowrap bg-card px-5 py-2 font-medium">
                        {student.number}. {student.firstName} {student.lastName}
                      </td>
                      {GRADE_COMPONENTS.map((component) => (
                        <td key={component.key} className="px-3 py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            max={component.max}
                            value={scores?.[component.key] ?? 0}
                            onChange={(e) =>
                              handleScoreChange(student.id, component.key, e.target.value, component.max)
                            }
                            className="w-14 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-center text-sm hover:border-input focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center font-semibold">{total}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{average.toFixed(1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
