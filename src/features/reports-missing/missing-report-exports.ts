import { downloadCsv } from '@/lib/export/csv-export'

import { buildMissingCsvTable, reportFilenameBase, type MissingReport, type MissingReportMeta } from './missing-report-model'

/**
 * Every export takes the SAME report object the screen shows (built by
 * buildMissingReport for the current filters), so CSV, Word and PDF can
 * never disagree with the report or with each other. Files are generated
 * in the browser and downloaded directly — nothing is uploaded or stored.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One row per student-assignment obligation, UTF-8 with BOM (Excel). */
export function downloadMissingCsv(report: MissingReport, meta: MissingReportMeta): void {
  downloadCsv(buildMissingCsvTable(report, meta), reportFilenameBase(meta))
}

/** Editable .docx with real Word tables (the docx library is loaded only
 * when needed). */
export async function downloadMissingDocx(report: MissingReport, meta: MissingReportMeta): Promise<void> {
  const { buildMissingReportDocx } = await import('./missing-report-docx')
  const blob = await buildMissingReportDocx(report, meta)
  downloadBlob(blob, `${reportFilenameBase(meta)}.docx`)
}

/** Real PDF (selectable Thai text, embedded font). pdfmake and the font
 * are loaded only when needed. */
export async function downloadMissingPdf(report: MissingReport, meta: MissingReportMeta): Promise<void> {
  const { createMissingReportPdfBlob } = await import('./missing-report-pdf')
  const blob = await createMissingReportPdfBlob(report, meta)
  downloadBlob(blob, `${reportFilenameBase(meta)}.pdf`)
}
