import { buildCsvContent, type ExportTable } from '@/lib/export/export-table'

export function downloadCsv(table: ExportTable, filename: string): void {
  const content = buildCsvContent(table)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
