import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { parseScoreInput } from '@/services/assignment-service'
import type { SgsStudentSourceScoreRow } from '@/services/sgs-score-calculation-service'
import { getSgsScoreCellMenuActions, SGS_SCORE_CELL_MENU_LABEL, SGS_SCORE_ORIGIN_TOOLTIP, type SgsScoreCellMenuAction } from '@/services/sgs-score-origin'
import {
  SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL,
  SGS_SCORE_CALCULATION_MODE_LABEL,
  SGS_SCORE_CALCULATION_ROUNDING_LABEL,
  type SgsScoreCalculationFormula,
} from '@/types/sgs-score-calculation'
import type { ResolvedSgsScoreCell, SgsScoreCellAction } from '@/types/sgs-score-workspace'

export type SgsScoreCellDialogAction = SgsScoreCellAction | 'recalculate'

interface SgsScoreCellDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  columnLabel: string
  maxScore: number
  studentName: string
  cell: ResolvedSgsScoreCell
  formula: SgsScoreCalculationFormula | null
  supportsOrigin: boolean
  /** What today's source scores calculate to — undefined when it can't
   * be computed (no formula / formula needs re-configuring). */
  liveCalculated: number | null | undefined
  /** Every linked source with THIS student's current raw score (see
   * buildStudentSourceScoreRows). */
  sourceRows: SgsStudentSourceScoreRow[]
  busy: boolean
  onAction: (action: SgsScoreCellDialogAction, value?: number) => Promise<void>
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

const ORIGIN_LABEL = { auto: 'อัตโนมัติ', override: 'ครูกำหนดเอง', empty: 'ว่าง' } as const

/**
 * "ที่มาคะแนน" — explains ONE cell: every linked source with this
 * student's real score ("งานที่ใช้คำนวณ"), then คะแนนคำนวณปัจจุบัน /
 * คะแนนที่ครูกำหนด (override only) / คะแนนที่ใช้ส่ง SGS, the rule and when
 * it was last calculated, and offers exactly the actions that apply to it (see
 * getSgsScoreCellMenuActions). Every write goes through the tab's
 * onAction, which uses the atomic set_sgs_score_cell /
 * recalculate_sgs_score_column RPCs (0027).
 */
export function SgsScoreCellDialog({
  open,
  onOpenChange,
  columnLabel,
  maxScore,
  studentName,
  cell,
  formula,
  supportsOrigin,
  liveCalculated,
  sourceRows,
  busy,
  onAction,
}: SgsScoreCellDialogProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)

  const actions = getSgsScoreCellMenuActions(cell, formula !== null, supportsOrigin, liveCalculated)
  /** What today's source scores calculate to; falls back to the stored
   * calculated value when the sources couldn't be evaluated. */
  const currentCalculated = liveCalculated !== undefined ? liveCalculated : cell.calculatedScore
  const storedDiffers = liveCalculated !== undefined && cell.calculatedAt !== null && liveCalculated !== cell.calculatedScore

  function startEditing() {
    setDraft(cell.effectiveScore !== null ? String(cell.effectiveScore) : '')
    setDraftError(null)
    setEditing(true)
  }

  async function saveDraft() {
    const { value, error } = parseScoreInput(draft, maxScore)
    if (error) {
      setDraftError(error)
      return
    }
    if (value === null) {
      setDraftError('กรุณากรอกคะแนน — หากต้องการล้างคะแนนให้ใช้ปุ่ม "ล้างคะแนน"')
      return
    }
    await onAction('override', value)
    setEditing(false)
  }

  async function run(action: SgsScoreCellMenuAction) {
    if (action === 'edit' || action === 'override') {
      startEditing()
      return
    }
    if (action === 'recalculate') await onAction('recalculate')
    else if (action === 'suppress_auto') await onAction('suppress_auto')
    else await onAction('clear_override')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(false)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ที่มาคะแนน — {columnLabel}</DialogTitle>
          <DialogDescription>
            {studentName} · เต็ม {maxScore}
          </DialogDescription>
        </DialogHeader>

        {formula ? (
          <section className="space-y-1.5" aria-label="งานที่ใช้คำนวณ">
            <h3 className="text-sm font-semibold">งานที่ใช้คำนวณ</h3>
            {sourceRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">ยังไม่ได้โหลดงานต้นทาง หรือไม่มีงานที่เชื่อมไว้</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {sourceRows.map((row, index) => (
                  <li key={`${row.assignmentId}-${index}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="break-words">{row.label}</span>
                      {(row.groupLabel || row.weightPercent !== null) && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({[row.groupLabel, row.weightPercent !== null ? `น้ำหนัก ${row.weightPercent}%` : null].filter(Boolean).join(' · ')})
                        </span>
                      )}
                      {row.status !== 'active' && (
                        <span className="ml-1 text-xs text-destructive">{row.status === 'archived' ? 'เก็บถาวรแล้ว — ไม่นำมาคำนวณ' : 'ถูกลบแล้ว — ไม่นำมาคำนวณ'}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {row.status === 'active' ? formatScore(row.rawScore) : '—'} / {row.maxScore ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {SGS_SCORE_CALCULATION_MODE_LABEL[formula.mode]} · ไม่มีคะแนน: {SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL[formula.missingScorePolicy]} · ปัดคะแนน{' '}
              {SGS_SCORE_CALCULATION_ROUNDING_LABEL[formula.rounding]}
            </p>
          </section>
        ) : (
          <p className="text-xs text-muted-foreground">ช่องนี้ยังไม่ได้เชื่อมกับงาน — คะแนนมาจากการกรอกเองเท่านั้น</p>
        )}

        <dl className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          {supportsOrigin && formula && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">คะแนนคำนวณปัจจุบัน</dt>
              <dd className="text-right tabular-nums">
                {formatScore(currentCalculated)} / {maxScore}
                {storedDiffers && (
                  <span className="block text-xs text-amber-700">ที่บันทึกไว้: {formatScore(cell.calculatedScore)} (ยังไม่ได้อัปเดต)</span>
                )}
              </dd>
            </div>
          )}
          {supportsOrigin && cell.overrideScore !== null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">คะแนนที่ครูกำหนด</dt>
              <dd className="tabular-nums">
                {formatScore(cell.overrideScore)} / {maxScore}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <dt className="font-medium">คะแนนที่ใช้ส่ง SGS</dt>
            <dd className="flex items-center gap-2 font-semibold tabular-nums">
              {formatScore(cell.effectiveScore)} / {maxScore}
              <Badge variant="outline" title={cell.origin === 'empty' ? undefined : SGS_SCORE_ORIGIN_TOOLTIP[cell.origin]}>
                {ORIGIN_LABEL[cell.origin]}
              </Badge>
            </dd>
          </div>
          {cell.autoSuppressed && <p className="text-xs text-muted-foreground">ยกเลิกการคำนวณสำหรับนักเรียนคนนี้ไว้ — ช่องนี้จึงว่าง (การเชื่อมงานของคอลัมน์ยังอยู่)</p>}
          {cell.origin === 'override' && formula && currentCalculated !== null && currentCalculated !== cell.overrideScore && (
            <p className="text-xs text-muted-foreground">
              ครูกำหนดคะแนนเองไว้ — กด "กลับไปใช้คะแนนคำนวณ" เพื่อใช้ {formatScore(currentCalculated)} / {maxScore} จากงานต้นทาง
            </p>
          )}
          {cell.calculatedAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">คำนวณล่าสุด</dt>
              <dd className="text-xs">{new Date(cell.calculatedAt).toLocaleString('th-TH')}</dd>
            </div>
          )}
        </dl>

        {editing ? (
          <div className="space-y-1.5 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              {SGS_SCORE_CELL_MENU_LABEL[formula ? 'override' : 'edit']}
              <Input
                type="number"
                min={0}
                max={maxScore}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-8 w-24"
                autoFocus
                aria-label="คะแนนใหม่"
              />
            </label>
            {draftError && <p className="text-xs text-destructive">{draftError}</p>}
            {formula && supportsOrigin && <p className="text-xs text-muted-foreground">คะแนนจากงานต้นทางจะยังถูกเก็บไว้ — กลับไปใช้ได้ทุกเมื่อ</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void saveDraft()} disabled={busy}>
                บันทึก
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                ยกเลิก
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="การจัดการคะแนน">
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant={action === 'clear' || action === 'suppress_auto' ? 'outline' : 'secondary'}
                disabled={busy}
                onClick={() => void run(action)}
              >
                {SGS_SCORE_CELL_MENU_LABEL[action]}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
