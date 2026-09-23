import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { parseScoreInput } from '@/services/assignment-service'
import type { SgsSourceContribution } from '@/services/sgs-score-calculation-service'
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
  contributions: SgsSourceContribution[]
  busy: boolean
  onAction: (action: SgsScoreCellDialogAction, value?: number) => Promise<void>
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

const ORIGIN_LABEL = { auto: 'อัตโนมัติ', override: 'ครูกำหนดเอง', empty: 'ว่าง' } as const

/**
 * "ที่มาคะแนน" — explains ONE cell (effective / calculated / override,
 * the linked sources and what each contributed, the rule, when it was
 * last calculated) and offers exactly the actions that apply to it (see
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
  contributions,
  busy,
  onAction,
}: SgsScoreCellDialogProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)

  const actions = getSgsScoreCellMenuActions(cell, formula !== null, supportsOrigin)
  const liveDiffers = liveCalculated !== undefined && cell.calculatedAt !== null && liveCalculated !== cell.calculatedScore

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

        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">คะแนนที่ใช้ (ส่งไป SGS)</dt>
            <dd className="flex items-center gap-2 font-semibold">
              {formatScore(cell.effectiveScore)}
              <Badge variant="outline" title={cell.origin === 'empty' ? undefined : SGS_SCORE_ORIGIN_TOOLTIP[cell.origin]}>
                {ORIGIN_LABEL[cell.origin]}
              </Badge>
            </dd>
          </div>
          {supportsOrigin && formula && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">คะแนนจากงานต้นทาง</dt>
              <dd>
                {formatScore(cell.calculatedScore)}
                {liveDiffers && <span className="ml-2 text-xs text-amber-700">ต้นทางปัจจุบัน: {formatScore(liveCalculated)} (ยังไม่ได้คำนวณใหม่)</span>}
              </dd>
            </div>
          )}
          {supportsOrigin && cell.overrideScore !== null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">คะแนนที่ครูกำหนด</dt>
              <dd>{formatScore(cell.overrideScore)}</dd>
            </div>
          )}
          {cell.autoSuppressed && <p className="text-xs text-muted-foreground">ยกเลิกการคำนวณสำหรับนักเรียนคนนี้ไว้ — ช่องนี้จึงว่าง (การเชื่อมงานของคอลัมน์ยังอยู่)</p>}
          {cell.calculatedAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">คำนวณล่าสุด</dt>
              <dd className="text-xs">{new Date(cell.calculatedAt).toLocaleString('th-TH')}</dd>
            </div>
          )}
        </dl>

        {formula && (
          <section className="space-y-1.5" aria-label="งานที่เชื่อม">
            <h3 className="text-sm font-semibold">งานที่เชื่อม</h3>
            {contributions.length === 0 ? (
              <p className="text-xs text-muted-foreground">ไม่มีงานต้นทางที่ใช้งานอยู่</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">งาน</th>
                    <th className="py-1 pr-2 font-medium">คะแนน</th>
                    <th className="py-1 font-medium">ส่วนที่ได้</th>
                  </tr>
                </thead>
                <tbody>
                  {contributions.map((c) => (
                    <tr key={c.assignmentId} className="border-t border-border">
                      <td className="py-1 pr-2">{c.label}</td>
                      <td className="py-1 pr-2 tabular-nums">
                        {formatScore(c.rawScore)}/{c.maxScore}
                      </td>
                      <td className="py-1 tabular-nums">{c.contribution === null ? '—' : c.contribution.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-muted-foreground">
              {SGS_SCORE_CALCULATION_MODE_LABEL[formula.mode]} · {SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL[formula.missingScorePolicy]} · ปัดคะแนน{' '}
              {SGS_SCORE_CALCULATION_ROUNDING_LABEL[formula.rounding]}
            </p>
          </section>
        )}

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
