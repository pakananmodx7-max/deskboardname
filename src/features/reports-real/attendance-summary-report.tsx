import { useEffect, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { ExportButtons } from '@/features/reports-real/export-buttons'
import { buildAttendanceExportTable, buildFilterSubtitle } from '@/features/reports-real/report-export-builders'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getAttendanceSummaryReport } from '@/services/report-service'
import type { AttendanceSummaryRow, ReportFilters } from '@/types/report'

interface AttendanceSummaryReportProps {
  filters: ReportFilters
  classroomName: string | null
  subjectName: string | null
}

export function AttendanceSummaryReport({ filters, classroomName, subjectName }: AttendanceSummaryReportProps) {
  const [rows, setRows] = useState<AttendanceSummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getAttendanceSummaryReport(filters)
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
          buildTable={() => buildAttendanceExportTable(rows, subtitle)}
          filenameBase="attendance-summary"
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
                  <th className="px-3 py-3 text-center font-medium">มา</th>
                  <th className="px-3 py-3 text-center font-medium">สาย</th>
                  <th className="px-3 py-3 text-center font-medium">ลา</th>
                  <th className="px-3 py-3 text-center font-medium">ขาด</th>
                  <th className="px-3 py-3 text-center font-medium">รวม</th>
                  <th className="px-3 py-3 text-center font-medium">% การเข้าเรียน</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-destructive">
                      {error}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-muted-foreground">
                      ไม่มีข้อมูลการเข้าเรียนในช่วงที่เลือก
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.studentId}:${row.classroomId}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-muted-foreground">{row.number ?? '-'}</td>
                      <td className="px-4 py-2 font-medium">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{row.classroomName}</td>
                      <td className="px-3 py-2 text-center">{row.present}</td>
                      <td className="px-3 py-2 text-center">{row.late}</td>
                      <td className="px-3 py-2 text-center">{row.leave}</td>
                      <td className="px-3 py-2 text-center">{row.absent}</td>
                      <td className="px-3 py-2 text-center font-semibold">{row.total}</td>
                      <td className="px-3 py-2 text-center">
                        {row.attendanceRate !== null ? `${row.attendanceRate.toFixed(1)}%` : '-'}
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
