import { ArrowLeft, Download, FileText, Printer, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { todayIso } from '@/features/classroom-analytics/analytics'
import { useMissingReportData } from '@/features/reports-missing/missing-report-data-source'
import { MissingReportDocument } from '@/features/reports-missing/missing-report-document'
import { MISSING_REPORT_DOCUMENT_CSS } from '@/features/reports-missing/missing-report-document-css'
import { downloadMissingCsv, downloadMissingDocx, downloadMissingPdf } from '@/features/reports-missing/missing-report-exports'
import { buildMissingReport, buildReportMeta, reportFilenameBase } from '@/features/reports-missing/missing-report-model'
import { backToReportHref, filtersFromParams } from '@/features/reports-missing/missing-report-params'
import { useReportTeacherName } from '@/features/reports-missing/use-report-teacher-name'
import { useSemester } from '@/features/semester/semester-store'
import { toFriendlyErrorMessage } from '@/lib/errors'

type Busy = 'pdf' | 'docx' | 'csv' | null

/**
 * A4 print preview for Reports → งานค้างส่ง (/teacher/reports/missing/print).
 * Rendered outside the teacher layout, so no sidebar or top bar ever
 * reaches the paper; the action bar is hidden when printing. Filters come
 * from the URL (the same ones the report page used), and the semester from
 * the shared selection — the document, PDF, Word and CSV are all built
 * from one buildMissingReport() result.
 */
export function MissingReportPrintPage() {
  const { context, scope, retryContext } = useSemester()
  const { data, refresh } = useMissingReportData()
  const teacherName = useReportTeacherName()
  const [searchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams])
  const { toast } = useToast()
  const [busy, setBusy] = useState<Busy>(null)
  const today = todayIso()

  const report = useMemo(
    () =>
      context.status === 'success' && scope && data.status === 'success'
        ? buildMissingReport({ context: context.data, scope, roster: data.data[0], assignments: data.data[1], filters, today })
        : null,
    [context, scope, data, filters, today],
  )
  const meta = useMemo(
    () => (context.status === 'success' && scope ? buildReportMeta({ context: context.data, scope, filters, teacherName, today }) : null),
    [context, scope, filters, teacherName, today],
  )

  // The browser uses the page title as the default "Save as PDF" name.
  useEffect(() => {
    if (!meta) return
    const previous = document.title
    document.title = reportFilenameBase(meta)
    return () => {
      document.title = previous
    }
  }, [meta])

  async function run(kind: Exclude<Busy, null>) {
    if (!report || !meta) return
    setBusy(kind)
    try {
      if (kind === 'pdf') await downloadMissingPdf(report, meta)
      else if (kind === 'docx') await downloadMissingDocx(report, meta)
      else downloadMissingCsv(report, meta)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ส่งออกรายงานไม่สำเร็จ'))
    } finally {
      setBusy(null)
    }
  }

  const error = context.status === 'error' ? context.error : data.status === 'error' ? data.error : null
  const ready = Boolean(report && meta)

  return (
    <div className="min-h-screen bg-muted/60 print:bg-white">
      <style>{MISSING_REPORT_DOCUMENT_CSS}</style>
      <div className="kc-no-print sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
          <Button asChild variant="outline" size="sm">
            <Link to={backToReportHref(filters)}>
              <ArrowLeft className="size-4" />
              กลับไปรายงาน
            </Link>
          </Button>
          <p className="mr-auto text-sm font-semibold text-foreground">ตัวอย่างก่อนพิมพ์ (A4)</p>
          <Button type="button" size="sm" onClick={() => window.print()} disabled={!ready}>
            <Printer className="size-4" />
            พิมพ์
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => run('pdf')} disabled={!ready || busy !== null}>
            <Download className="size-4" />
            {busy === 'pdf' ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => run('docx')} disabled={!ready || busy !== null}>
            <FileText className="size-4" />
            {busy === 'docx' ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด Word'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => run('csv')} disabled={!ready || busy !== null || report?.obligations.length === 0}>
            <Download className="size-4" />
            ดาวน์โหลด CSV
          </Button>
        </div>
      </div>

      <main className="px-2 py-6 print:p-0">
        {error ? (
          <div role="alert" className="kc-no-print mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-card p-8 text-center">
            <p className="text-sm text-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={context.status === 'error' ? retryContext : refresh}>
              <RotateCw className="size-4" />
              ลองใหม่
            </Button>
          </div>
        ) : report && meta ? (
          <div className="overflow-x-auto">
            <MissingReportDocument report={report} meta={meta} />
          </div>
        ) : (
          <div role="status" aria-label="กำลังเตรียมรายงาน" className="kc-no-print mx-auto h-[60vh] max-w-[210mm] animate-pulse rounded bg-card" />
        )}
      </main>
    </div>
  )
}
