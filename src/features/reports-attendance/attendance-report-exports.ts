import { downloadCsv } from '@/lib/export/csv-export'
import { downloadBlob } from '@/lib/export/download-blob'

import { attendanceFilenameBase, buildAttendanceCsvTable, type AttendanceReport, type AttendanceReportMeta } from './attendance-report-model'

/**
 * Every export takes the SAME report object the screen shows (built by
 * buildAttendanceReport for the current filters) — all pages of the
 * student table, never just the visible page. Files are generated in the
 * browser and downloaded directly; nothing is uploaded or stored.
 */

export function downloadAttendanceCsv(report: AttendanceReport, meta: AttendanceReportMeta): void {
  downloadCsv(buildAttendanceCsvTable(report, meta), attendanceFilenameBase(meta))
}

export async function downloadAttendanceDocx(report: AttendanceReport, meta: AttendanceReportMeta): Promise<void> {
  const { buildAttendanceDocx } = await import('./attendance-report-docx')
  downloadBlob(await buildAttendanceDocx(report, meta), `${attendanceFilenameBase(meta)}.docx`)
}

export async function downloadAttendancePdf(report: AttendanceReport, meta: AttendanceReportMeta): Promise<void> {
  const { createAttendancePdfBlob } = await import('./attendance-report-pdf')
  downloadBlob(await createAttendancePdfBlob(report, meta), `${attendanceFilenameBase(meta)}.pdf`)
}
