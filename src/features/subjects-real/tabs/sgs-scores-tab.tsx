import { Calculator, Link2, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { ScoreCalculationModal } from '@/features/subjects-real/score-calculation-modal'
import { SgsColumnSourcesDialog, type SgsColumnOriginCounts } from '@/features/subjects-real/sgs-column-sources-dialog'
import { SgsScoreCell } from '@/features/subjects-real/sgs-score-cell'
import { SgsScoreCellDialog, type SgsScoreCellDialogAction } from '@/features/subjects-real/sgs-score-cell-dialog'
import { parseScoreInput } from '@/services/assignment-service'
import {
  convertSgsScoreColumnToAuto,
  countSgsOverrideCells,
  recalculateSgsCellFromSources,
  sgsAutoRecalculation,
} from '@/services/sgs-score-auto-service'
import {
  buildStudentSourceScoreRows,
  computeLiveCalculatedScores,
  describeFormulaSources,
  getSgsScoreCalculationSources,
  listFormulaSourceIds,
  type SgsScoreCalculationAssignmentMeta,
} from '@/services/sgs-score-calculation-service'
import {
  effectiveScoresFromCells,
  hasSgsCalculationDrift,
  interpretSgsScoreCellInput,
  resolveSgsScoreCell,
} from '@/services/sgs-score-origin'
import {
  buildSgsScoreWorkspaceMultiPayload,
  buildSgsScoreWorkspacePayload,
  buildSgsScoreWorkspaceRows,
  computeSgsScoreWorkspaceSendPlan,
  createSgsScoreColumn,
  deleteSgsScoreColumn,
  getSgsScoreColumnFormulas,
  getSgsScoreCellsForColumns,
  getSgsScoreColumns,
  recalculateSgsScoreColumn,
  selectSgsScoreWorkspaceColumnsForExport,
  setSgsScore,
  setSgsScoreCell,
  validateSgsScoreWorkspaceMultiPayload,
  validateSgsScoreWorkspacePayload,
} from '@/services/sgs-score-workspace-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { downloadJson } from '@/lib/export/json-export'
import { cn } from '@/lib/utils'
import type { SgsScoreCalculationFormula, SgsScoreCalculationSource } from '@/types/sgs-score-calculation'
import type { ResolvedSgsScoreCell, SgsScoreCellRecord, SgsScoreColumn } from '@/types/sgs-score-workspace'
import type { ClassroomStudent } from '@/types/student'

interface SgsScoresTabProps {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
}

/**
 * "คะแนน SGS" — a spreadsheet completely INDEPENDENT from normal
 * assignment scores (see docs/DATABASE.md Phase 16 and
 * src/services/sgs-score-workspace-service.ts's own doc comment). Every
 * column here is a teacher-defined mirror of one real SGS score column
 * (label + max score, confirmed against the live SGS page via the SGS
 * Bridge extension's diagnostic) — never an assignment, never rendered
 * in or computed from ตรวจงานและคะแนน. Entering a score here writes only
 * to `sgs_scores`; it can never change, and is never changed by, an
 * assignment_submissions row.
 *
 * Real Supabase data only — no demo-mode counterpart on purpose (see the
 * service module's own doc comment): a bridge payload must never be
 * built from mock students.
 */
export function SgsScoresTab({ subjectId, subjectName, classroomId, classroomName }: SgsScoresTabProps) {
  const { toast } = useToast()

  const [columns, setColumns] = useState<SgsScoreColumn[]>([])
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  /** Raw sgs_scores rows per column (see SgsScoreCellRecord). Every
   * display value is DERIVED from these via resolveSgsScoreCell — there is
   * no second, independently-edited copy of any score in this component. */
  const [cellRecordsByColumnId, setCellRecordsByColumnId] = useState<Record<string, Record<string, SgsScoreCellRecord>>>({})
  /** Migration 0027 applied? false = the pre-0027 behavior, unchanged
   * (plain scores, no AUTO/OVERRIDE) — decided by the base load itself,
   * never by a separate request that could fail the page. */
  const [supportsScoreOrigin, setSupportsScoreOrigin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetTicks, setResetTicks] = useState<Record<string, number>>({})

  const [newColumnLabel, setNewColumnLabel] = useState('')
  const [newColumnMaxScore, setNewColumnMaxScore] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)

  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [targetColumnId, setTargetColumnId] = useState<string | null>(null)
  /**
   * The export checkboxes are stored as the DESELECTED ids, not the
   * selected ones, so that every column is ticked by default and a
   * column added later arrives ticked too — the teacher only ever has to
   * untick what they do not want to send. `selectedExportColumnIds`
   * below turns it back into the plain selection the rest of the file
   * (and the payload builder) works with.
   */
  const [deselectedExportColumnIds, setDeselectedExportColumnIds] = useState<string[]>([])

  /** SGS Score Calculator — a SAME-PAGE modal only (see
   * score-calculation-modal.tsx's own doc comment). Opening/closing it
   * never navigates away from this tab; it only reads assignment scores
   * and, once approved, writes into `calcColumn`'s own sgs_scores rows
   * via the existing setSgsScore. */
  const [calcColumn, setCalcColumn] = useState<SgsScoreColumn | null>(null)
  /** Saved formulas, fetched and error-handled COMPLETELY SEPARATELY
   * from the base workspace load below (see getSgsScoreColumnFormulas's
   * own doc comment) — a column with no entry here just means "no saved
   * formula" (or "not loaded yet"), never a reason to show the whole
   * page as broken. */
  const [formulasByColumnId, setFormulasByColumnId] = useState<Record<string, SgsScoreCalculationFormula | null>>({})
  const [formulaLoadError, setFormulaLoadError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    // A source-assignment score saved moments ago (another tab of this
    // workspace) may still be recalculating its SGS columns — wait for
    // that first so this load never shows the pre-save values.
    return sgsAutoRecalculation
      .flush(subjectId, classroomId)
      .then(() => Promise.all([getSgsScoreColumns(subjectId, classroomId), getStudentsByClassroom(classroomId)]))
      .then(async ([columnRows, studentRows]) => {
        setColumns(columnRows)
        setStudents(studentRows)
        // ONE request for every column's cells (never one per column),
        // degrading to the plain pre-0027 read when 0027 isn't applied.
        const { supportsScoreOrigin: supported, cellsByColumnId } = await getSgsScoreCellsForColumns(columnRows.map((c) => c.id))
        setSupportsScoreOrigin(supported)
        setCellRecordsByColumnId(cellsByColumnId)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subjectId, classroomId])

  /** The calculator's OWN load step — never awaited by, and never able
   * to fail, refresh() above. If migration 0025 has not been applied to
   * this database yet, this throws and only the small calculator notice
   * below shows; the base table still renders normally. */
  const refreshFormulas = useCallback(() => {
    setFormulaLoadError(null)
    return getSgsScoreColumnFormulas(subjectId, classroomId)
      .then((formulas) => setFormulasByColumnId(formulas))
      .catch((err: unknown) => setFormulaLoadError(`ไม่สามารถโหลดงานที่เชื่อมกับช่อง SGS ได้ (${toFriendlyErrorMessage(err, 'โหลดสูตรคำนวณไม่สำเร็จ')}) — จึงแสดงงานที่เชื่อมและคำนวณอัตโนมัติไม่ได้ หากฐานข้อมูลยังไม่มีคอลัมน์ calculation_formula ต้องติดตั้ง migration 0025 ก่อน`))
  }, [subjectId, classroomId])

  useEffect(() => {
    refresh()
    void refreshFormulas()
  }, [refresh, refreshFormulas])

  /** Current source-assignment scores for every calculated column — its
   * OWN independently-failing load (same rule as refreshFormulas: a
   * failure only disables "what do today's sources calculate to", never
   * the table). One getAssignments + ONE batched submissions request. */
  const [sourceData, setSourceData] = useState<{
    sources: SgsScoreCalculationSource[]
    assignments: SgsScoreCalculationAssignmentMeta[]
    scoresByStudentIdAndAssignmentId: Record<string, Record<string, number | null>>
  } | null>(null)
  const hasAnyFormula = Object.values(formulasByColumnId).some((f) => f !== null)
  const [sourceLoadError, setSourceLoadError] = useState<string | null>(null)
  const refreshSources = useCallback(() => {
    return getSgsScoreCalculationSources(subjectId, classroomId)
      .then((data) => {
        setSourceData(data)
        setSourceLoadError(null)
      })
      .catch((err: unknown) => {
        setSourceData(null)
        setSourceLoadError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดงานต้นทางได้'))
      })
  }, [subjectId, classroomId])
  useEffect(() => {
    if (hasAnyFormula) void refreshSources()
  }, [hasAnyFormula, refreshSources])

  /** columnId -> studentId -> resolved cell, for EVERY roster student
   * (a student with no row resolves to EMPTY, never 0). */
  const resolvedByColumnId = useMemo(() => {
    const result: Record<string, Record<string, ResolvedSgsScoreCell>> = {}
    for (const column of columns) {
      const records = cellRecordsByColumnId[column.id] ?? {}
      const cells: Record<string, ResolvedSgsScoreCell> = {}
      for (const student of students) cells[student.id] = resolveSgsScoreCell(records[student.id])
      result[column.id] = cells
    }
    return result
  }, [columns, students, cellRecordsByColumnId])

  /** The EFFECTIVE score per column/student — the only values the table,
   * the SGS send preview and every exported payload ever read. */
  const scoresByColumnId = useMemo(() => {
    const result: Record<string, Record<string, number | null>> = {}
    for (const [columnId, cells] of Object.entries(resolvedByColumnId)) result[columnId] = effectiveScoresFromCells(cells)
    return result
  }, [resolvedByColumnId])

  /** What today's source scores calculate to, per calculated column —
   * `null` for a column whose saved formula can't run as-is (a source
   * was archived/deleted or the column's max changed). */
  const liveByColumnId = useMemo(() => {
    const result: Record<string, Record<string, number | null> | null> = {}
    if (!sourceData) return result
    for (const column of columns) {
      const formula = formulasByColumnId[column.id]
      if (!formula) continue
      result[column.id] = computeLiveCalculatedScores(
        formula,
        column.maxScore,
        students.map((s) => s.id),
        sourceData.scoresByStudentIdAndAssignmentId,
        sourceData.sources,
      )
    }
    return result
  }, [columns, students, formulasByColumnId, sourceData])

  const driftCountByColumnId = useMemo(() => {
    const result: Record<string, number> = {}
    if (!supportsScoreOrigin) return result
    for (const column of columns) {
      const live = liveByColumnId[column.id]
      if (!live) continue
      result[column.id] = students.filter((s) => hasSgsCalculationDrift(resolvedByColumnId[column.id][s.id], live[s.id])).length
    }
    return result
  }, [columns, students, liveByColumnId, resolvedByColumnId, supportsScoreOrigin])

  const rows = useMemo(
    () => buildSgsScoreWorkspaceRows(students, columns, scoresByColumnId),
    [students, columns, scoresByColumnId],
  )

  /** Writes to ONE cell are chained, so rapid edits reach the database
   * in exactly the order the teacher made them (an older request can
   * never land after, and overwrite, a newer one). */
  const cellQueueRef = useRef(new Map<string, Promise<unknown>>())
  function enqueueCellWrite<T>(cellKey: string, work: () => Promise<T>): Promise<T> {
    const previous = cellQueueRef.current.get(cellKey) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    cellQueueRef.current.set(cellKey, next)
    return next
  }

  function storeCellRecord(columnId: string, studentId: string, record: SgsScoreCellRecord | null) {
    setCellRecordsByColumnId((prev) => {
      const column = { ...(prev[columnId] ?? {}) }
      if (record === null) delete column[studentId]
      else column[studentId] = record
      return { ...prev, [columnId]: column }
    })
  }

  /** Re-reads ONE cell after a recalculation (the RPC returns a count,
   * not the row). Only that student's record is replaced, so a concurrent
   * edit to a different cell in the same column is never overwritten
   * locally by this (older) read. */
  async function reloadCell(columnId: string, studentId: string) {
    const { cellsByColumnId } = await getSgsScoreCellsForColumns([columnId])
    storeCellRecord(columnId, studentId, cellsByColumnId[columnId]?.[studentId] ?? null)
  }

  /** One cell action. 0027: the atomic set_sgs_score_cell /
   * recalculate_sgs_score_column RPCs compute the effective score in the
   * database, and the returned row replaces local state. Before 0027:
   * the original setSgsScore (override = the value, clear = null). */
  async function performCellAction(column: SgsScoreColumn, studentId: string, action: SgsScoreCellDialogAction, value?: number) {
    const cellKey = `${column.id}:${studentId}`
    await enqueueCellWrite(cellKey, async () => {
      if (!supportsScoreOrigin) {
        const score = action === 'override' ? (value ?? null) : null
        await setSgsScore(column.id, studentId, score)
        storeCellRecord(column.id, studentId, { score, calculatedScore: null, overrideScore: null, autoSuppressed: false, calculatedAt: null })
        return
      }
      if (action === 'recalculate') {
        // Always from FRESH source scores, never the ones loaded when the
        // tab opened — an assignment score may have changed since.
        const formula = formulasByColumnId[column.id]
        const fresh = await getSgsScoreCalculationSources(subjectId, classroomId)
        setSourceData(fresh)
        const live = formula
          ? computeLiveCalculatedScores(formula, column.maxScore, [studentId], fresh.scoresByStudentIdAndAssignmentId, fresh.sources)
          : null
        if (!live) throw new Error('ยังคำนวณจากงานต้นทางไม่ได้ — ตรวจสอบการตั้งค่าการคำนวณของช่องนี้')
        await recalculateSgsScoreColumn(column.id, [{ studentId, calculatedScore: live[studentId] ?? null }])
        await reloadCell(column.id, studentId)
        return
      }
      const mappedFormula = formulasByColumnId[column.id]
      if (action === 'clear_override' && mappedFormula) {
        // "กลับไปใช้คะแนนคำนวณ": recalculate from FRESH source scores and
        // clear the override in the same RPC call, so the effective score
        // is today's calculated value — never a calculated_score stored
        // before a source score changed (or never stored, for a legacy
        // cell backfilled as an override).
        const restored = await recalculateSgsCellFromSources(subjectId, classroomId, column, mappedFormula, studentId, true)
        if (restored) {
          setSourceData(restored.sourceData)
          await reloadCell(column.id, studentId)
          return
        }
        // The mapping can't run as saved — fall through to the plain
        // clear_override (uses the stored calculated value).
      }
      const record = await setSgsScoreCell(column.id, studentId, action, action === 'override' ? (value ?? null) : null)
      storeCellRecord(column.id, studentId, record)
    })
  }

  const [detailCell, setDetailCell] = useState<{ columnId: string; studentId: string } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  /** "🔗 N งาน · Auto" — the column-sources dialog (see
   * sgs-column-sources-dialog.tsx). Opening it re-reads the source
   * assignments so names/max scores are current. */
  const [sourcesColumn, setSourcesColumn] = useState<SgsScoreColumn | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)

  function openSourcesDialog(column: SgsScoreColumn) {
    setSourcesColumn(column)
    void refreshSources()
  }

  function originCountsFor(columnId: string): SgsColumnOriginCounts {
    const counts: SgsColumnOriginCounts = { auto: 0, override: 0, suppressed: 0, empty: 0 }
    for (const cell of Object.values(resolvedByColumnId[columnId] ?? {})) {
      if (cell.origin === 'auto') counts.auto += 1
      else if (cell.origin === 'override') counts.override += 1
      else if (cell.autoSuppressed) counts.suppressed += 1
      else counts.empty += 1
    }
    return counts
  }

  /** "เปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ" (confirmed in the dialog) —
   * ONE column, fresh sources, one atomic RPC; a per-student
   * "ยกเลิกการคำนวณ" is kept. */
  async function handleConvertToAuto(column: SgsScoreColumn) {
    const formula = formulasByColumnId[column.id]
    if (!formula) return
    setConvertBusy(true)
    try {
      const outcome = await convertSgsScoreColumnToAuto(subjectId, classroomId, column, formula)
      toast(`เปลี่ยน "${column.label}" เป็นคำนวณอัตโนมัติแล้ว — ล้างคะแนนที่ครูกำหนดเอง ${outcome.overridesCleared} คน`)
      await Promise.all([refresh(), refreshSources()])
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'เปลี่ยนเป็นคำนวณอัตโนมัติไม่สำเร็จ'))
    } finally {
      setConvertBusy(false)
    }
  }

  const selectedExportColumnIds = useMemo(
    () => columns.filter((column) => !deselectedExportColumnIds.includes(column.id)).map((column) => column.id),
    [columns, deselectedExportColumnIds],
  )
  const exportColumns = useMemo(
    () => selectSgsScoreWorkspaceColumnsForExport(columns, selectedExportColumnIds),
    [columns, selectedExportColumnIds],
  )

  function toggleExportColumn(columnId: string) {
    setDeselectedExportColumnIds((prev) =>
      prev.includes(columnId) ? prev.filter((id) => id !== columnId) : [...prev, columnId],
    )
  }

  async function handleAddColumn() {
    const label = newColumnLabel.trim()
    const maxScore = Number(newColumnMaxScore)
    if (label === '') {
      toast('กรุณากรอกชื่อคอลัมน์')
      return
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      toast('กรุณากรอกคะแนนเต็มมากกว่า 0')
      return
    }
    setAddingColumn(true)
    try {
      await createSgsScoreColumn({ subjectId, classroomId, label, maxScore })
      setNewColumnLabel('')
      setNewColumnMaxScore('')
      await refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเพิ่มคอลัมน์ได้'))
    } finally {
      setAddingColumn(false)
    }
  }

  async function handleDeleteColumn(column: SgsScoreColumn) {
    if (!window.confirm(`ลบคอลัมน์ "${column.label}" และคะแนนทั้งหมดในคอลัมน์นี้?`)) return
    try {
      await deleteSgsScoreColumn(column.id)
      if (targetColumnId === column.id) setTargetColumnId(null)
      setDeselectedExportColumnIds((prev) => prev.filter((id) => id !== column.id))
      await refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบคอลัมน์ได้'))
    }
  }

  async function handleScoreBlur(column: SgsScoreColumn, studentId: string, raw: string) {
    const cellKey = `${column.id}:${studentId}`
    const resetCell = () => setResetTicks((prev) => ({ ...prev, [cellKey]: (prev[cellKey] ?? 0) + 1 }))
    const { value: score, error: validationError } = parseScoreInput(raw, column.maxScore)
    if (validationError) {
      toast(validationError)
      resetCell()
      return
    }
    const cell = resolvedByColumnId[column.id]?.[studentId] ?? resolveSgsScoreCell(undefined)
    const intent = interpretSgsScoreCellInput(cell, score)
    if (intent.kind === 'noop') return
    if (intent.kind === 'blank_on_auto') {
      // An empty input never silently breaks the column's mapping — the
      // explicit per-student action lives in the ⋯ menu.
      toast('ช่องนี้คำนวณจากงานที่เชื่อม — หากต้องการให้ว่าง ใช้เมนู ⋯ > ยกเลิกการคำนวณสำหรับนักเรียนคนนี้')
      resetCell()
      return
    }
    try {
      if (intent.kind === 'override') {
        await performCellAction(column, studentId, 'override', intent.value)
      } else {
        await performCellAction(column, studentId, 'clear_override')
        if (supportsScoreOrigin && formulasByColumnId[column.id]) {
          toast('กลับไปใช้คะแนนคำนวณจากงานต้นทางแล้ว')
        }
      }
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
      resetCell()
    }
  }

  async function handleDetailAction(action: SgsScoreCellDialogAction, value?: number) {
    if (!detailCell) return
    const column = columns.find((c) => c.id === detailCell.columnId)
    if (!column) return
    setDetailBusy(true)
    try {
      await performCellAction(column, detailCell.studentId, action, value)
      setResetTicks((prev) => ({ ...prev, [`${column.id}:${detailCell.studentId}`]: (prev[`${column.id}:${detailCell.studentId}`] ?? 0) + 1 }))
      toast('บันทึกแล้ว')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
    } finally {
      setDetailBusy(false)
    }
  }

  const targetColumn = columns.find((c) => c.id === targetColumnId) ?? null
  const plan = targetColumn ? computeSgsScoreWorkspaceSendPlan(rows, targetColumn.id, targetColumn.maxScore) : []
  const sendCount = plan.filter((r) => r.action === 'send').length
  const skippedNoScoreCount = plan.filter((r) => r.action === 'skip_no_score').length
  const skippedOverMaxCount = plan.filter((r) => r.action === 'skip_over_max').length

  function handleDownloadPayload() {
    if (!targetColumn) return
    const payload = buildSgsScoreWorkspacePayload(
      {
        subjectId,
        subjectName,
        classroomId,
        classroomName,
        targetColumn: { key: targetColumn.id, label: targetColumn.label, maxScore: targetColumn.maxScore },
      },
      plan,
    )
    const validation = validateSgsScoreWorkspacePayload(payload)
    if (!validation.ok) {
      // Should never happen — buildSgsScoreWorkspacePayload only ever
      // produces a shape validateSgsScoreWorkspacePayload accepts — but
      // this never hands a file to the extension without re-checking it
      // first, exactly like the assignment-scoped export dialog does.
      toast('ไม่สามารถเตรียมข้อมูลได้ กรุณาลองใหม่')
      return
    }
    downloadJson(payload, `sgs-bridge-${targetColumn.label}-${classroomName}`)
    toast('ดาวน์โหลดไฟล์สำหรับ SGS Bridge แล้ว — เปิด Chrome Extension เพื่อโหลดไฟล์นี้ต่อ')
  }

  /**
   * PRODUCTION multi-column export — ONE file carrying every column the
   * teacher ticked (key/label/maxScore) plus each student's score for
   * each of those columns, for the extension's production workflow
   * (map several SGS columns, write them in one run). Tick four columns
   * here and the extension reports "ช่องคะแนนที่โหลดมา 4". The
   * single-column export above is unchanged and still available.
   */
  function handleDownloadMultiPayload() {
    if (exportColumns.length === 0) return
    const payload = buildSgsScoreWorkspaceMultiPayload(
      { subjectId, subjectName, classroomId, classroomName, columns: exportColumns },
      rows,
    )
    const validation = validateSgsScoreWorkspaceMultiPayload(payload)
    if (!validation.ok) {
      toast('ไม่สามารถเตรียมข้อมูลได้ กรุณาลองใหม่')
      return
    }
    downloadJson(payload, `sgs-bridge-${exportColumns.length}ช่อง-${classroomName}`)
    toast(`ดาวน์โหลดไฟล์ ${exportColumns.length} ช่องคะแนนแล้ว — เปิด Chrome Extension เพื่อโหลดไฟล์นี้ต่อ`)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        ตารางนี้แยกออกจากคะแนนงาน (ตรวจงานและคะแนน) โดยสิ้นเชิง — คอลัมน์แต่ละอันมิเรอร์ช่องคะแนนจริงในระบบ SGS
        (ยืนยันด้วยการตรวจสอบโครงสร้างหน้า SGS จาก Chrome Extension) การกรอกคะแนนที่นี่ไม่มีผลต่อคะแนนงานใด ๆ
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {/* Deliberately separate from `error` above — a failure loading
       * saved calculator formulas (e.g. before migration 0025 has been
       * applied) is a small, calculator-scoped notice, never the same
       * banner as a broken workspace load. */}
      {formulaLoadError && <p className="text-xs text-muted-foreground">🧮 {formulaLoadError}</p>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            ชื่อคอลัมน์ (เช่น ช่อง 10)
            <Input
              value={newColumnLabel}
              onChange={(e) => setNewColumnLabel(e.target.value)}
              placeholder="ช่อง 10"
              className="w-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            คะแนนเต็ม
            <Input
              type="number"
              min={1}
              value={newColumnMaxScore}
              onChange={(e) => setNewColumnMaxScore(e.target.value)}
              placeholder="15"
              className="w-24"
            />
          </label>
          <Button type="button" size="sm" onClick={handleAddColumn} disabled={addingColumn}>
            <Plus className="size-3.5" />
            เพิ่มคอลัมน์ SGS
          </Button>
          <div className="ml-auto">
            <Button type="button" size="sm" variant="outline" onClick={() => setSendDialogOpen(true)} disabled={columns.length === 0}>
              <Send className="size-3.5" />
              ส่งไป SGS
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto rounded-xl">
            <table className="w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="sticky left-0 top-0 z-20 border-b border-border bg-card px-3 py-2.5 font-semibold">เลขที่</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-card px-3 py-2.5 font-semibold">รหัสนักเรียน</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-card px-5 py-2.5 font-semibold">ชื่อ-นามสกุล</th>
                  {columns.map((column) => (
                    <th key={column.id} className="sticky top-0 z-10 border-b border-border bg-card px-3 py-2.5 text-center font-semibold">
                      <div className="flex items-center justify-center gap-1">
                        {column.label}
                        <button
                          type="button"
                          onClick={() => handleDeleteColumn(column)}
                          className="text-muted-foreground hover:text-destructive"
                          title={`ลบคอลัมน์ ${column.label}`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                      <div className="font-normal text-muted-foreground">เต็ม {column.maxScore}</div>
                      {/* The mapping/calculation indicator — always rendered
                       * (never gated on the formula load succeeding). With a
                       * saved mapping: "🔗 N งาน · Auto"; without: "คำนวณ".
                       * Either way it opens the calculator, which shows the
                       * linked sources. */}
                      <button
                        type="button"
                        onClick={() => (formulasByColumnId[column.id] ? openSourcesDialog(column) : setCalcColumn(column))}
                        className="mx-auto mt-0.5 flex items-center justify-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
                        title={formulasByColumnId[column.id] ? 'ดูงานที่เชื่อม วิธีคำนวณ และคะแนนเต็ม' : 'คำนวณคะแนนจากคะแนนต้นทาง'}
                      >
                        {formulasByColumnId[column.id] ? <Link2 className="size-3" /> : <Calculator className="size-3" />}
                        {formulasByColumnId[column.id]
                          ? `${listFormulaSourceIds(formulasByColumnId[column.id]!).length} งาน · ${supportsScoreOrigin ? 'Auto' : 'มีสูตร'}`
                          : 'คำนวณ'}
                      </button>
                      {supportsScoreOrigin && formulasByColumnId[column.id] && countSgsOverrideCells(resolvedByColumnId[column.id] ?? {}) > 0 && (
                        <button
                          type="button"
                          onClick={() => openSourcesDialog(column)}
                          className="mx-auto mt-0.5 flex items-center gap-1 text-[11px] font-normal text-violet-700 hover:underline"
                          title="คะแนนที่ครูกำหนดเองไม่เปลี่ยนตามงานต้นทาง — เปิดเพื่อเปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ"
                        >
                          ครูกำหนดเอง {countSgsOverrideCells(resolvedByColumnId[column.id] ?? {})} คน
                        </button>
                      )}
                      {(driftCountByColumnId[column.id] ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setCalcColumn(column)}
                          className="mx-auto mt-0.5 flex items-center gap-1 text-[11px] font-normal text-amber-700 hover:underline"
                          title="คะแนนในงานต้นทางเปลี่ยนหลังการคำนวณครั้งล่าสุด — เปิดเพื่อคำนวณใหม่"
                        >
                          <RefreshCw className="size-3" />
                          ต้นทางเปลี่ยน {driftCountByColumnId[column.id]} คน
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length + 3} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 3} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : columns.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีคอลัมน์คะแนน SGS — เพิ่มคอลัมน์ด้านบนก่อน
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => (
                    <tr
                      key={row.studentId}
                      className={cn(
                        'border-b border-border last:border-0 transition-colors hover:bg-muted/40',
                        rowIndex % 2 === 1 && 'bg-muted/20',
                      )}
                    >
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-medium text-foreground">
                        {row.studentNumber ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.studentCode ?? '-'}</td>
                      <td className="whitespace-nowrap px-5 py-2 font-medium text-foreground">{row.fullName}</td>
                      {columns.map((column) => {
                        const cell = resolvedByColumnId[column.id]?.[row.studentId] ?? resolveSgsScoreCell(undefined)
                        const cellKey = `${column.id}:${row.studentId}`
                        const live = liveByColumnId[column.id]
                        return (
                          <td key={column.id} className="px-2 py-2 text-center">
                            <SgsScoreCell
                              cell={cell}
                              maxScore={column.maxScore}
                              hasFormula={supportsScoreOrigin && Boolean(formulasByColumnId[column.id])}
                              drift={supportsScoreOrigin && Boolean(live) && hasSgsCalculationDrift(cell, live?.[row.studentId])}
                              inputKey={`${cellKey}-${cell.origin}-${cell.effectiveScore}-${resetTicks[cellKey] ?? 0}`}
                              ariaLabel={`${column.label} ${row.fullName}`}
                              onCommit={(raw) => handleScoreBlur(column, row.studentId, raw)}
                              onOpenDetails={() => {
                                setDetailCell({ columnId: column.id, studentId: row.studentId })
                                // Current source scores for "งานที่ใช้คำนวณ".
                                if (formulasByColumnId[column.id]) void refreshSources()
                              }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ส่งคะแนนไป SGS</DialogTitle>
            <DialogDescription>
              รายวิชา: {subjectName} · ห้อง: {classroomName}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-1.5 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">เลือกช่องคะแนนที่จะส่ง (เลือกได้หลายช่อง)</legend>
            <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDeselectedExportColumnIds([])}
                disabled={columns.length === 0}
              >
                เลือกทั้งหมด
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDeselectedExportColumnIds(columns.map((column) => column.id))}
                disabled={selectedExportColumnIds.length === 0}
              >
                ยกเลิกทั้งหมด
              </Button>
              <span className="text-xs text-muted-foreground">
                เลือกแล้ว <span className="font-semibold text-foreground">{selectedExportColumnIds.length}</span> /{' '}
                {columns.length} ช่อง
              </span>
            </div>
            {columns.map((column) => (
              <div key={column.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <label className="flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    name="sgs-workspace-export-columns"
                    value={column.id}
                    checked={selectedExportColumnIds.includes(column.id)}
                    onChange={() => toggleExportColumn(column.id)}
                    className="size-4"
                  />
                  {column.label} — เต็ม {column.maxScore}
                </label>
                <button
                  type="button"
                  onClick={() => setTargetColumnId(targetColumnId === column.id ? null : column.id)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {targetColumnId === column.id ? 'ซ่อนตัวอย่าง' : 'ดูตัวอย่างรายคน'}
                </button>
              </div>
            ))}
          </fieldset>

          {exportColumns.some((c) => (driftCountByColumnId[c.key] ?? 0) > 0) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              คะแนนต้นทางเปลี่ยนแต่ยังไม่ได้คำนวณใหม่:{' '}
              {exportColumns
                .filter((c) => (driftCountByColumnId[c.key] ?? 0) > 0)
                .map((c) => `${c.label} (${driftCountByColumnId[c.key]} คน)`)
                .join(', ')}{' '}
              — ไฟล์นี้จะใช้คะแนนที่บันทึกไว้ขณะนี้ หากต้องการใช้คะแนนล่าสุด ให้คำนวณใหม่ก่อน
            </p>
          )}

          {targetColumn && (
            <>
              <p className="text-sm font-medium">ตัวอย่างรายคน — {targetColumn.label}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>
                  นักเรียนทั้งหมด <span className="font-semibold text-foreground">{rows.length}</span> คน
                </span>
                <span>
                  จะส่ง <span className="font-semibold text-foreground">{sendCount}</span> คน
                </span>
                <span>
                  ข้าม (ไม่มีคะแนน) <span className="font-semibold text-foreground">{skippedNoScoreCount}</span> คน
                </span>
                {skippedOverMaxCount > 0 && (
                  <span className="text-destructive">
                    เกินคะแนนเต็ม (จะไม่ส่ง) <span className="font-semibold">{skippedOverMaxCount}</span> คน
                  </span>
                )}
              </div>

              <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
                <table className="w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr>
                      <th className="border-b border-border px-3 py-2 font-medium">เลขที่</th>
                      <th className="border-b border-border px-3 py-2 font-medium">นักเรียน</th>
                      <th className="border-b border-border px-3 py-2 font-medium">คะแนน SGS</th>
                      <th className="border-b border-border px-3 py-2 font-medium">ส่งหรือไม่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((row) => (
                      <tr key={row.studentId}>
                        <td className="border-b border-border px-3 py-2">{row.studentNumber ?? '-'}</td>
                        <td className="border-b border-border px-3 py-2">{row.fullName}</td>
                        <td className="border-b border-border px-3 py-2">{row.score ?? '—'}</td>
                        <td className="border-b border-border px-3 py-2">
                          {row.action === 'send' ? (
                            'ส่ง'
                          ) : (
                            <span className="text-muted-foreground">
                              {row.action === 'skip_over_max' ? 'ไม่ส่ง (เกินคะแนนเต็ม)' : 'ไม่ส่ง (ไม่มีคะแนน)'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            ขั้นตอนนี้เป็นการเตรียมไฟล์เท่านั้น ยังไม่มีการส่งคะแนนไป SGS โดยอัตโนมัติ — เปิดไฟล์นี้ใน SGS Bridge
            Chrome Extension เพื่อดำเนินการต่อ ไฟล์เดียวจะมีครบทุกช่องคะแนนที่เลือกไว้ (ส่วนหัวของส่วนขยายจะแสดง
            "ช่องคะแนนที่โหลดมา {exportColumns.length}")
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSendDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" variant="outline" onClick={handleDownloadPayload} disabled={!targetColumn}>
              ดาวน์โหลดเฉพาะช่องที่ดูตัวอย่าง
            </Button>
            <Button type="button" onClick={handleDownloadMultiPayload} disabled={exportColumns.length === 0}>
              ดาวน์โหลดช่องที่เลือก ({exportColumns.length} ช่อง)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {calcColumn && (
        <ScoreCalculationModal
          open={calcColumn !== null}
          onOpenChange={(next) => {
            if (!next) setCalcColumn(null)
          }}
          subjectId={subjectId}
          classroomId={classroomId}
          targetColumn={calcColumn}
          existingFormula={formulasByColumnId[calcColumn.id] ?? null}
          students={students}
          // 0027: only TEACHER-OWNED values count as "existing" — an AUTO
          // cell is always recalculated, an override/suppression is kept
          // unless the teacher confirms เขียนทับ. Before 0027: every
          // non-empty cell, exactly as before.
          existingTargetScores={
            supportsScoreOrigin
              ? Object.fromEntries(
                  Object.entries(resolvedByColumnId[calcColumn.id] ?? {})
                    .filter(([, cell]) => cell.origin === 'override')
                    .map(([studentId, cell]) => [studentId, cell.overrideScore]),
                )
              : (scoresByColumnId[calcColumn.id] ?? {})
          }
          supportsScoreOrigin={supportsScoreOrigin}
          protectedStudentIds={
            supportsScoreOrigin
              ? new Set(
                  Object.entries(resolvedByColumnId[calcColumn.id] ?? {})
                    .filter(([, cell]) => cell.autoSuppressed)
                    .map(([studentId]) => studentId),
                )
              : undefined
          }
          targetCells={supportsScoreOrigin ? resolvedByColumnId[calcColumn.id] : undefined}
          onApplied={async () => {
            await Promise.all([refresh(), refreshFormulas(), refreshSources()])
          }}
        />
      )}

      {sourcesColumn && formulasByColumnId[sourcesColumn.id] && (
        <SgsColumnSourcesDialog
          open
          onOpenChange={(next) => {
            if (!next) setSourcesColumn(null)
          }}
          column={sourcesColumn}
          formula={formulasByColumnId[sourcesColumn.id]!}
          sources={sourceData ? describeFormulaSources(formulasByColumnId[sourcesColumn.id]!, sourceData.assignments) : null}
          sourcesError={sourceData ? null : sourceLoadError}
          supportsOrigin={supportsScoreOrigin}
          counts={originCountsFor(sourcesColumn.id)}
          busy={convertBusy}
          onConvertToAuto={() => handleConvertToAuto(sourcesColumn)}
          onOpenCalculator={() => {
            setCalcColumn(sourcesColumn)
            setSourcesColumn(null)
          }}
        />
      )}

      {detailCell &&
        (() => {
          const column = columns.find((c) => c.id === detailCell.columnId)
          const student = students.find((s) => s.id === detailCell.studentId)
          if (!column || !student) return null
          const cell = resolvedByColumnId[column.id]?.[student.id] ?? resolveSgsScoreCell(undefined)
          const formula = formulasByColumnId[column.id] ?? null
          const live = liveByColumnId[column.id]
          return (
            <SgsScoreCellDialog
              open
              onOpenChange={(next) => {
                if (!next) setDetailCell(null)
              }}
              columnLabel={column.label}
              maxScore={column.maxScore}
              studentName={`${student.firstName} ${student.lastName}`.trim()}
              cell={cell}
              formula={supportsScoreOrigin ? formula : null}
              supportsOrigin={supportsScoreOrigin}
              liveCalculated={live ? (live[student.id] ?? null) : undefined}
              sourceRows={
                formula && sourceData
                  ? buildStudentSourceScoreRows(
                      formula,
                      sourceData.assignments,
                      sourceData.scoresByStudentIdAndAssignmentId[student.id] ?? {},
                      sourceData.sources,
                    )
                  : []
              }
              busy={detailBusy}
              onAction={handleDetailAction}
            />
          )
        })()}
    </div>
  )
}
