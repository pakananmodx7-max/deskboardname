import { Loader2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/select'
import {
  detectHeaderRow,
  HEADER_DETECTION_CONFIDENCE_THRESHOLD,
  HEADER_SCAN_LIMIT,
} from '@/features/student-import/detect-header-row'
import { HeaderRowPicker } from '@/features/student-import/header-row-picker'
import {
  buildParsedSpreadsheet,
  readSpreadsheetGrid,
  type SpreadsheetGrid,
} from '@/features/student-import/parse-student-file'
import { autoDetectMapping } from '@/features/student-import/student-import-mapper'
import { StudentImportPreview } from '@/features/student-import/student-import-preview'
import { commitImportRows, resolveImportRows } from '@/features/student-import/student-import-resolver'
import { parseImportRows, summarizeImportRows } from '@/features/student-import/student-import-validator'
import {
  IMPORT_TARGET_FIELDS,
  IMPORT_TARGET_FIELD_LABELS,
  type ColumnMapping,
  type ImportCommitResult,
  type ImportTargetField,
  type ParsedSpreadsheet,
  type ResolvedImportRow,
} from '@/features/student-import/types'
import { toFriendlyErrorMessage } from '@/lib/errors'

type Step = 'select' | 'header-row' | 'mapping' | 'resolving' | 'preview' | 'importing' | 'result'

interface StudentImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classroomId: string
  /** Used only as an optional cross-check (see parseImportRows'
   * expectedClassroomName param) against the file's own "classroom"
   * column, when the teacher maps one — never to route rows to a
   * different classroom than classroomId above. */
  classroomName: string
  onImported: () => void
}

const UNMAPPED = '__unmapped__'

export function StudentImportDialog({
  open,
  onOpenChange,
  classroomId,
  classroomName,
  onImported,
}: StudentImportDialogProps) {
  const [step, setStep] = useState<Step>('select')
  const [error, setError] = useState<string | null>(null)
  const [grid, setGrid] = useState<SpreadsheetGrid | null>(null)
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [resolvedRows, setResolvedRows] = useState<ResolvedImportRow[]>([])
  const [result, setResult] = useState<ImportCommitResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const summary = useMemo(() => summarizeImportRows(resolvedRows), [resolvedRows])

  const canProceedMapping =
    (mapping.firstName !== undefined && mapping.lastName !== undefined) ||
    mapping.fullName !== undefined

  function reset() {
    setStep('select')
    setError(null)
    setGrid(null)
    setHeaderRowIndex(0)
    setParsed(null)
    setMapping({})
    setResolvedRows([])
    setResult(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  function proceedWithHeaderRow(sourceGrid: SpreadsheetGrid, chosenIndex: number) {
    try {
      const parsedSheet = buildParsedSpreadsheet(sourceGrid, chosenIndex)
      setParsed(parsedSheet)
      setMapping(autoDetectMapping(parsedSheet.headers))
      setStep('mapping')
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถอ่านไฟล์นี้ได้'))
      setStep('select')
    }
  }

  async function handleFileSelected(file: File) {
    setError(null)
    try {
      const sourceGrid = await readSpreadsheetGrid(file)
      const detection = detectHeaderRow(sourceGrid.allRows)

      if (detection.confidence >= HEADER_DETECTION_CONFIDENCE_THRESHOLD) {
        // Confident guess — skip straight to mapping, same as before for
        // any file whose header genuinely is near the top.
        proceedWithHeaderRow(sourceGrid, detection.headerRowIndex)
        return
      }

      // Low confidence (title rows, blank spacer rows, or an ambiguous
      // file) — let the teacher confirm which row is actually the header,
      // pre-selected to the best guess so far.
      setGrid(sourceGrid)
      setHeaderRowIndex(detection.headerRowIndex)
      setStep('header-row')
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถอ่านไฟล์นี้ได้'))
    }
  }

  function handleConfirmHeaderRow() {
    if (!grid) return
    setError(null)
    proceedWithHeaderRow(grid, headerRowIndex)
  }

  function handleColumnFieldChange(columnIndex: number, value: string) {
    setMapping((prev) => {
      const next = { ...prev }
      for (const field of IMPORT_TARGET_FIELDS) {
        if (next[field] === columnIndex) delete next[field]
      }
      if (value !== UNMAPPED) {
        next[value as ImportTargetField] = columnIndex
      }
      return next
    })
  }

  async function handleConfirmMapping() {
    if (!parsed) return
    setStep('resolving')
    setError(null)
    try {
      const draftRows = parseImportRows(parsed, mapping, classroomName)
      const resolved = await resolveImportRows(draftRows, classroomId)
      setResolvedRows(resolved)
      setStep('preview')
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถตรวจสอบข้อมูลได้'))
      setStep('mapping')
    }
  }

  async function handleConfirmImport() {
    setStep('importing')
    setError(null)
    try {
      const commitResult = await commitImportRows(resolvedRows, classroomId)
      setResult(commitResult)
      setStep('result')
      onImported()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถนำเข้าข้อมูลได้'))
      setStep('preview')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Students</DialogTitle>
          <DialogDescription>นำเข้ารายชื่อนักเรียนจากไฟล์ .xlsx หรือ .csv</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        {step === 'select' && (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files?.[0]
              if (file) void handleFileSelected(file)
            }}
          >
            <Upload className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">ลากไฟล์มาวางที่นี่ หรือ</p>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              เลือกไฟล์
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFileSelected(file)
                e.target.value = ''
              }}
            />
            <p className="text-xs text-muted-foreground">รองรับ .xlsx และ .csv สูงสุด 500 คนต่อไฟล์</p>
          </div>
        )}

        {step === 'header-row' && grid && (
          <HeaderRowPicker
            rows={grid.allRows.slice(0, HEADER_SCAN_LIMIT)}
            selectedIndex={headerRowIndex}
            onSelect={setHeaderRowIndex}
          />
        )}

        {step === 'mapping' && parsed && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              จับคู่คอลัมน์จากไฟล์ &ldquo;{parsed.fileName}&rdquo; กับข้อมูลนักเรียน
            </p>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {parsed.headers.map((header, index) => {
                const currentField = IMPORT_TARGET_FIELDS.find((field) => mapping[field] === index)
                return (
                  <div key={index} className="flex items-center gap-3 rounded-md border border-border p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{header || `คอลัมน์ ${index + 1}`}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {parsed.rows[0]?.[index] || '—'}
                      </p>
                    </div>
                    <NativeSelect
                      className="w-44 shrink-0"
                      value={currentField ?? UNMAPPED}
                      onChange={(e) => handleColumnFieldChange(index, e.target.value)}
                    >
                      <option value={UNMAPPED}>ไม่ใช้คอลัมน์นี้</option>
                      {IMPORT_TARGET_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {IMPORT_TARGET_FIELD_LABELS[field]}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )
              })}
            </div>
            {!canProceedMapping && (
              <p className="text-xs text-destructive">
                กรุณาจับคู่อย่างน้อย &ldquo;ชื่อ&rdquo; และ &ldquo;นามสกุล&rdquo; หรือ &ldquo;ชื่อ-นามสกุล&rdquo;
              </p>
            )}
          </div>
        )}

        {step === 'resolving' && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            กำลังตรวจสอบข้อมูล...
          </div>
        )}

        {step === 'preview' && <StudentImportPreview rows={resolvedRows} summary={summary} />}

        {step === 'importing' && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            กำลังนำเข้าข้อมูล...
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-3">
            <p className="text-sm font-medium">นำเข้าสำเร็จ</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border border-border p-3">
                <p className="text-muted-foreground">สร้างนักเรียนใหม่</p>
                <p className="text-lg font-semibold">{result.created}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-muted-foreground">เชื่อมนักเรียนเดิม</p>
                <p className="text-lg font-semibold">{result.linkedExisting}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-muted-foreground">ข้อมูลซ้ำ</p>
                <p className="text-lg font-semibold">{result.duplicates}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-muted-foreground">ไม่สำเร็จ</p>
                <p className="text-lg font-semibold">{result.failed}</p>
              </div>
            </div>
            {result.failedRows.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-2 py-1.5">แถว</th>
                      <th className="px-2 py-1.5">ชื่อ-นามสกุล</th>
                      <th className="px-2 py-1.5">สาเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failedRows.map((row) => (
                      <tr key={row.rowNumber} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5">{row.rowNumber}</td>
                        <td className="px-2 py-1.5">
                          {row.firstName} {row.lastName}
                        </td>
                        <td className="px-2 py-1.5 text-destructive">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'header-row' && <Button onClick={handleConfirmHeaderRow}>ถัดไป</Button>}
          {step === 'mapping' && (
            <Button onClick={handleConfirmMapping} disabled={!canProceedMapping}>
              ถัดไป
            </Button>
          )}
          {step === 'preview' && (
            <Button onClick={handleConfirmImport} disabled={summary.ready === 0}>
              ยืนยันนำเข้า ({summary.ready})
            </Button>
          )}
          {step === 'result' && <Button onClick={() => handleOpenChange(false)}>เสร็จสิ้น</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
