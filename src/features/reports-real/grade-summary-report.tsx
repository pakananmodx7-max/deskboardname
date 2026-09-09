import { useEffect, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExportButtons } from '@/features/reports-real/export-buttons'
import { buildFilterSubtitle, buildGradeExportTable } from '@/features/reports-real/report-export-builders'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getGradeSummaryReport } from '@/services/report-service'
import type { GradeSummaryGroup, ReportFilters } from '@/types/report'

interface GradeSummaryReportProps {
  filters: ReportFilters
  classroomName: string | null
  subjectName: string | null
}

export function GradeSummaryReport({ filters, classroomName, subjectName }: GradeSummaryReportProps) {
  const [groups, setGroups] = useState<GradeSummaryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getGradeSummaryReport(filters)
      .then((data) => {
        if (active) setGroups(data)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [filters])

  const subtitle = buildFilterSubtitle(filters, classroomName, subjectName)
  const hasData = groups.some((g) => g.students.length > 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <ExportButtons
          buildTable={() => buildGradeExportTable(groups, subtitle)}
          filenameBase="grade-summary"
          disabled={!hasData}
        />
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            ไม่มีข้อมูลคะแนนในช่วงที่เลือก
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={`${group.subjectId}:${group.classroomId}`}>
            <CardHeader>
              <CardTitle className="text-base">
                {group.subjectName} · {group.classroomName}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="sticky left-0 bg-card px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                      {group.assignments.map((a) => (
                        <th key={a.assignmentId} className="px-3 py-3 text-center font-medium">
                          {a.title}
                          <div className="font-normal">/{a.maxScore}</div>
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center font-medium">รวม</th>
                      <th className="px-3 py-3 text-center font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.students.map((student) => (
                      <tr key={student.studentId} className="border-b border-border last:border-0">
                        <td className="sticky left-0 whitespace-nowrap bg-card px-5 py-2 font-medium">
                          {student.number ?? '-'}. {student.firstName} {student.lastName}
                        </td>
                        {group.assignments.map((a) => (
                          <td key={a.assignmentId} className="px-3 py-2 text-center text-muted-foreground">
                            {student.scoresByAssignment[a.assignmentId] ?? '-'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center font-semibold">
                          {student.totalEarned}/{student.totalPossible}
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground">
                          {student.percentage !== null ? `${student.percentage.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
