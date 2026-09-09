import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ExportButtons } from '@/features/reports-real/export-buttons'
import { buildFilterSubtitle, buildMissingAssignmentExportTable } from '@/features/reports-real/report-export-builders'
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getMissingAssignmentReport } from '@/services/report-service'
import type { MissingAssignmentRow, ReportFilters } from '@/types/report'

interface MissingAssignmentReportProps {
  filters: ReportFilters
  classroomName: string | null
  subjectName: string | null
}

const STATUS_LABEL: Record<string, string> = {
  not_submitted: 'ยังไม่ส่ง',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'ไม่มีกำหนดส่ง'
  return new Date(dueDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function MissingAssignmentReport({ filters, classroomName, subjectName }: MissingAssignmentReportProps) {
  const [rows, setRows] = useState<MissingAssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getMissingAssignmentReport(filters)
      .then((data) => {
        if (active) setRows(data)
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
          buildTable={() => buildMissingAssignmentExportTable(rows, subtitle)}
          filenameBase="missing-assignments"
          disabled={rows.length === 0}
        />
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
                  <th className="px-4 py-3 font-medium">วิชา</th>
                  <th className="px-4 py-3 font-medium">งาน</th>
                  <th className="px-4 py-3 font-medium">กำหนดส่ง</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-destructive">
                      {error}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">
                      ไม่มีงานค้างส่งในช่วงที่เลือก
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={`${row.studentId}:${row.assignmentId}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2 text-muted-foreground">{row.number ?? '-'}</td>
                      <td className="px-4 py-2 font-medium">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{row.classroomName}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.subjectName}</td>
                      <td className="px-4 py-2">
                        <Link
                          to={buildAssignmentDetailPath(row.subjectId, row.classroomId, row.assignmentId)}
                          className="hover:underline"
                        >
                          {row.assignmentTitle}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDueDate(row.dueDate)}</td>
                      <td className="px-4 py-2">
                        <Badge variant={row.status === 'missing' ? 'destructive' : 'warning'}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
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
