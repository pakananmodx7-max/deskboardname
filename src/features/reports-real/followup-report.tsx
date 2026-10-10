import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ExportButtons } from '@/features/reports-real/export-buttons'
import { buildFilterSubtitle, buildFollowUpExportTable } from '@/features/reports-real/report-export-builders'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { computeFollowUpReport, FOLLOWUP_RULES } from '@/services/followup-report-service'
import { getAttendanceSummaryReport, getGradeSummaryReport, getMissingAssignmentReport } from '@/services/report-service'
import type { FollowUpRow, ReportFilters } from '@/types/report'

interface FollowUpReportProps {
  filters: ReportFilters
  classroomName: string | null
  subjectName: string | null
}

/**
 * Deterministic only — see followup-report-service.ts's doc comment for
 * every rule and its exact threshold. Built entirely from the same
 * three real reports above (same filters), never a separate query or
 * any AI/ML scoring.
 */
export function FollowUpReport({ filters, classroomName, subjectName }: FollowUpReportProps) {
  const [rows, setRows] = useState<FollowUpRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    Promise.all([
      getAttendanceSummaryReport(filters),
      getMissingAssignmentReport(filters),
      getGradeSummaryReport(filters),
    ])
      .then(([attendanceRows, missingRows, gradeGroups]) => {
        if (!active) return
        setRows(computeFollowUpReport(attendanceRows, missingRows, gradeGroups))
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <ExportButtons
          buildTable={() => buildFollowUpExportTable(rows, subtitle)}
          filenameBase="student-followup"
          disabled={rows.length === 0}
        />
      </div>

      <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">เกณฑ์ที่ใช้ (กฎที่กำหนดไว้ล่วงหน้าเท่านั้น ไม่มีการให้คะแนนด้วย AI และไม่ใช่การวินิจฉัย)</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>ขาดเรียนตั้งแต่ {FOLLOWUP_RULES.ABSENCE_THRESHOLD} ครั้งขึ้นไป ในช่วงวันที่ที่เลือก</li>
          <li>มีงานค้างตั้งแต่ {FOLLOWUP_RULES.MISSING_ASSIGNMENT_THRESHOLD} ชิ้นขึ้นไป</li>
          <li>
            ส่งงานต่ำกว่า {Math.round(FOLLOWUP_RULES.LOW_COMPLETION_RATE_THRESHOLD * 100)}% (เมื่อมีงานอย่างน้อย {FOLLOWUP_RULES.MIN_ASSIGNMENTS_FOR_COMPLETION_RULE} ชิ้น)
          </li>
          <li>คะแนนรวมต่ำกว่า {FOLLOWUP_RULES.LOW_GRADE_PERCENTAGE_THRESHOLD}% ของคะแนนเต็ม</li>
        </ul>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">เลขที่</th>
                  <th className="px-4 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-4 py-3 font-medium">ห้องเรียน</th>
                  <th className="px-4 py-3 font-medium">เหตุผล</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-destructive">
                      {error}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                      ไม่มีนักเรียนที่เข้าเกณฑ์ต้องติดตามในช่วงที่เลือก
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.studentId}:${row.classroomId}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-muted-foreground align-top">{row.number ?? '-'}</td>
                      <td className="px-4 py-2 font-medium align-top">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground align-top">{row.classroomName}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col gap-1.5">
                          {row.reasons.map((reason) => (
                            <Badge key={reason.rule} variant="warning" className="w-fit">
                              {reason.label}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
