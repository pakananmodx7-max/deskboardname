import { Calculator, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { describeFormulaRule, type SgsFormulaSourceDescription } from '@/services/sgs-score-calculation-service'
import { SGS_USE_AUTO_FOR_COLUMN_LABEL } from '@/services/sgs-score-auto-service'
import {
  SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL,
  SGS_SCORE_CALCULATION_MODE_LABEL,
  SGS_SCORE_CALCULATION_ROUNDING_LABEL,
  type SgsScoreCalculationFormula,
} from '@/types/sgs-score-calculation'
import type { SgsScoreColumn } from '@/types/sgs-score-workspace'

export interface SgsColumnOriginCounts {
  auto: number
  override: number
  suppressed: number
  empty: number
}

interface SgsColumnSourcesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  column: SgsScoreColumn
  formula: SgsScoreCalculationFormula
  /** describeFormulaSources(formula, assignments) — null while the
   * assignment list is not loaded (or failed to load). */
  sources: SgsFormulaSourceDescription[] | null
  sourcesError?: string | null
  supportsOrigin: boolean
  counts: SgsColumnOriginCounts
  onOpenCalculator: () => void
}

/**
 * "🔗 N งาน · Auto" — what feeds ONE SGS column: every linked assignment
 * (name, its max score, weight/group), the calculation method, missing-
 * score rule, rounding and the SGS column's own max, plus how the
 * column's cells currently split between AUTO and teacher-set values.
 * Read-only: turning teacher-set values back into AUTO is the column
 * header's single "ใช้คะแนนคำนวณอัตโนมัติทั้งคอลัมน์" action.
 */
export function SgsColumnSourcesDialog({
  open,
  onOpenChange,
  column,
  formula,
  sources,
  sourcesError = null,
  supportsOrigin,
  counts,
  onOpenCalculator,
}: SgsColumnSourcesDialogProps) {
  const maxMismatch = formula.targetMaxScore !== column.maxScore
  const showWeights = formula.mode !== 'proportional'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="size-4" />
              ที่มาคะแนน — {column.label}
            </DialogTitle>
            <DialogDescription>คะแนนเต็มช่อง SGS: {column.maxScore} คะแนน</DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <section className="space-y-2" aria-label="งานที่เชื่อม">
              <h3 className="text-sm font-semibold">งานที่เชื่อม ({sources?.length ?? '…'} งาน)</h3>
              {sources === null ? (
                <p className={sourcesError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{sourcesError ?? 'กำลังโหลดรายชื่องาน...'}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-xs text-muted-foreground">
                        <th className="px-3 py-1.5 font-medium">งาน</th>
                        <th className="px-3 py-1.5 font-medium">คะแนนเต็มงาน</th>
                        {showWeights && <th className="px-3 py-1.5 font-medium">น้ำหนัก</th>}
                        <th className="px-3 py-1.5 font-medium">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((source, index) => (
                        <tr key={`${source.assignmentId}-${index}`} className="border-t border-border">
                          <td className="px-3 py-1.5">
                            {source.label}
                            {source.groupLabel && <span className="ml-1 text-xs text-muted-foreground">({source.groupLabel})</span>}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">{source.maxScore ?? '—'}</td>
                          {showWeights && (
                            <td className="px-3 py-1.5 tabular-nums">{source.weightPercent !== null ? `${source.weightPercent}%` : '—'}</td>
                          )}
                          <td className="px-3 py-1.5 text-xs">
                            {source.status === 'active' ? (
                              <span className="text-muted-foreground">ใช้งานอยู่</span>
                            ) : (
                              <span className="text-destructive">{source.status === 'archived' ? 'เก็บถาวรแล้ว — ไม่นำมาคำนวณ' : 'ถูกลบแล้ว — ไม่นำมาคำนวณ'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-label="วิธีคำนวณ">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">วิธีคำนวณ</dt>
                <dd>{SGS_SCORE_CALCULATION_MODE_LABEL[formula.mode]}</dd>
                {sources && (
                  <>
                    <dt className="text-muted-foreground">สูตร</dt>
                    <dd className="tabular-nums">{describeFormulaRule(formula, sources, column.maxScore)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">งานที่ไม่มีคะแนน</dt>
                <dd>{SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL[formula.missingScorePolicy]}</dd>
                <dt className="text-muted-foreground">การปัดคะแนน</dt>
                <dd>{SGS_SCORE_CALCULATION_ROUNDING_LABEL[formula.rounding]}</dd>
                <dt className="text-muted-foreground">คะแนนเต็มช่อง SGS</dt>
                <dd className="tabular-nums">{column.maxScore}</dd>
              </dl>
              {maxMismatch && (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  สูตรนี้บันทึกไว้สำหรับคะแนนเต็ม {formula.targetMaxScore} แต่ช่องนี้เต็ม {column.maxScore} — ต้องตั้งค่าการคำนวณใหม่ก่อน
                  ระบบจึงจะคำนวณอัตโนมัติได้
                </p>
              )}
            </section>

            {supportsOrigin && (
              <section className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm" aria-label="สถานะคะแนนในช่องนี้">
                <p>
                  คำนวณอัตโนมัติ <span className="font-semibold">{counts.auto}</span> คน · ครูกำหนดเอง{' '}
                  <span className="font-semibold">{counts.override}</span> คน
                  {counts.suppressed > 0 && (
                    <>
                      {' '}
                      · ยกเลิกการคำนวณ <span className="font-semibold">{counts.suppressed}</span> คน
                    </>
                  )}{' '}
                  · ว่าง <span className="font-semibold">{counts.empty}</span> คน
                </p>
                <p className="text-xs text-muted-foreground">
                  {counts.override + counts.suppressed > 0
                    ? `คะแนนที่ครูกำหนดเองจะไม่เปลี่ยนตามงานต้นทาง — ใช้ปุ่ม "${SGS_USE_AUTO_FOR_COLUMN_LABEL}" ที่หัวคอลัมน์เพื่อให้ทั้งคอลัมน์คำนวณอัตโนมัติ`
                    : 'ทุกช่องใช้คะแนนคำนวณ — เมื่อแก้คะแนนงานที่เชื่อม คะแนนช่องนี้จะอัปเดตอัตโนมัติ'}
                </p>
              </section>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
            <Button type="button" variant="outline" onClick={onOpenCalculator}>
              <Calculator className="size-3.5" />
              แก้ไขงานที่เชื่อม / ดูตัวอย่างการคำนวณ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  )
}
