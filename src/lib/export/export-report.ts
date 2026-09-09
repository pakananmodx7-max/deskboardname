import { downloadCsv } from '@/lib/export/csv-export'
import { downloadDocx } from '@/lib/export/docx-export'
import type { ExportTable } from '@/lib/export/export-table'
import { openPrintablePdf } from '@/lib/export/pdf-export'

export type ExportFormat = 'csv' | 'docx' | 'pdf'

/**
 * Single entry point every report screen's export buttons call — one
 * function per format, all fed the exact same already-filtered
 * ExportTable (see export-table.ts's doc comment for why that's what
 * makes exports respect the current filters).
 */
export async function exportReport(format: ExportFormat, table: ExportTable, filenameBase: string): Promise<void> {
  if (format === 'csv') {
    downloadCsv(table, filenameBase)
  } else if (format === 'docx') {
    await downloadDocx(table, filenameBase)
  } else {
    openPrintablePdf(table)
  }
}
