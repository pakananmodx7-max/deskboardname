import { Download } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { exportReport, type ExportFormat } from '@/lib/export/export-report'
import type { ExportTable } from '@/lib/export/export-table'

interface ExportButtonsProps {
  buildTable: () => ExportTable
  filenameBase: string
  disabled?: boolean
}

const FORMAT_LABEL: Record<ExportFormat, string> = { csv: 'CSV', docx: 'Word (.docx)', pdf: 'PDF' }

/** Builds the export table fresh, from whatever's on screen, at the
 * moment the teacher clicks — never a stale/cached table from before the
 * filters last changed, so an export always matches the currently
 * selected filters exactly. */
export function ExportButtons({ buildTable, filenameBase, disabled }: ExportButtonsProps) {
  const { toast } = useToast()
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  async function handleExport(format: ExportFormat) {
    setExporting(format)
    try {
      await exportReport(format, buildTable(), filenameBase)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'ไม่สามารถส่งออกรายงานได้')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((format) => (
        <Button
          key={format}
          variant="outline"
          size="sm"
          disabled={disabled || exporting !== null}
          onClick={() => handleExport(format)}
        >
          <Download className="size-3.5" />
          {exporting === format ? 'กำลังส่งออก...' : FORMAT_LABEL[format]}
        </Button>
      ))}
    </div>
  )
}
