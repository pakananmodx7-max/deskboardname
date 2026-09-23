import { Link2, MoreHorizontal, PencilLine, RefreshCw } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { SGS_SCORE_ORIGIN_TOOLTIP } from '@/services/sgs-score-origin'
import type { ResolvedSgsScoreCell } from '@/types/sgs-score-workspace'

interface SgsScoreCellProps {
  cell: ResolvedSgsScoreCell
  maxScore: number
  /** The column has a source mapping — only then do AUTO/OVERRIDE
   * indicators mean anything (a plain hand-entered column shows none,
   * keeping the table quiet). */
  hasFormula: boolean
  /** The persisted calculated value differs from what today's source
   * scores calculate to. */
  drift: boolean
  /** Changes whenever the input must be reset to the persisted value
   * (a rejected/failed edit). */
  inputKey: string
  ariaLabel: string
  onCommit: (raw: string) => void
  onOpenDetails: () => void
}

/**
 * One คะแนน SGS cell: the number input (typing = the teacher's own
 * value), a quiet origin indicator, and a "⋯" button opening the
 * "ที่มาคะแนน" dialog with every action. Indicators are icons with an
 * accessible label AND a native tooltip — never color alone.
 */
export function SgsScoreCell({ cell, maxScore, hasFormula, drift, inputKey, ariaLabel, onCommit, onOpenDetails }: SgsScoreCellProps) {
  return (
    <div className="flex items-center justify-center gap-1">
      <Input
        type="number"
        min={0}
        max={maxScore}
        defaultValue={cell.effectiveScore ?? ''}
        placeholder="—"
        key={inputKey}
        aria-label={ariaLabel}
        onBlur={(e) => onCommit(e.target.value)}
        className="h-8 w-16 text-center"
      />
      <span className="flex w-4 flex-col items-center gap-0.5">
        {hasFormula && cell.origin === 'auto' && (
          <Link2 className="size-3.5 text-primary" aria-label={SGS_SCORE_ORIGIN_TOOLTIP.auto} role="img">
            <title>{SGS_SCORE_ORIGIN_TOOLTIP.auto}</title>
          </Link2>
        )}
        {hasFormula && cell.origin === 'override' && (
          <PencilLine className="size-3.5 text-amber-600" aria-label={SGS_SCORE_ORIGIN_TOOLTIP.override} role="img">
            <title>{SGS_SCORE_ORIGIN_TOOLTIP.override}</title>
          </PencilLine>
        )}
        {drift && (
          <RefreshCw className="size-3 text-muted-foreground" aria-label="คะแนนจากงานต้นทางเปลี่ยน — ยังไม่ได้คำนวณใหม่" role="img">
            <title>คะแนนจากงานต้นทางเปลี่ยน — ยังไม่ได้คำนวณใหม่</title>
          </RefreshCw>
        )}
      </span>
      <button
        type="button"
        onClick={onOpenDetails}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`ที่มาคะแนนและตัวเลือก — ${ariaLabel}`}
        title="ดูที่มาคะแนน"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  )
}
