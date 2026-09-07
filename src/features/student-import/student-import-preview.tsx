import { Badge } from '@/components/ui/badge'
import type { ImportPreviewSummary, ImportRowStatus, ResolvedImportRow } from '@/features/student-import/types'

const statusLabel: Record<ImportRowStatus, string> = {
  ready: 'Ready',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
}

const statusVariant: Record<ImportRowStatus, 'success' | 'warning' | 'destructive'> = {
  ready: 'success',
  duplicate: 'warning',
  invalid: 'destructive',
}

interface StudentImportPreviewProps {
  rows: ResolvedImportRow[]
  summary: ImportPreviewSummary
}

export function StudentImportPreview({ rows, summary }: StudentImportPreviewProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <span className="font-medium">พบทั้งหมด: {summary.total} คน</span>
        <span className="text-success">พร้อมนำเข้า: {summary.ready}</span>
        <span className="text-warning-foreground">ข้อมูลซ้ำ: {summary.duplicate}</span>
        <span className="text-destructive">ข้อมูลไม่ครบ: {summary.invalid}</span>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">เลขที่</th>
              <th className="px-3 py-2 font-medium">รหัสนักเรียน</th>
              <th className="px-3 py-2 font-medium">ชื่อ</th>
              <th className="px-3 py-2 font-medium">นามสกุล</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Badge variant={statusVariant[row.status]}>{statusLabel[row.status]}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.number ?? '-'}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.studentCode ?? '-'}</td>
                <td className="px-3 py-2">
                  {row.firstName || '-'}
                  {row.fullNameAmbiguous && (
                    <span className="ml-1 text-xs text-warning-foreground">(โปรดตรวจสอบ)</span>
                  )}
                </td>
                <td className="px-3 py-2">{row.lastName || '-'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{row.reason ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
