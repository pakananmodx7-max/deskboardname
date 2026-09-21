import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  applySgsScoreCalculation,
  calculateClassPreview,
  countExistingTargetScores,
  getSgsScoreCalculationSources,
  planSgsScoreCalculationApply,
  validateCalculationConfig,
} from '@/services/sgs-score-calculation-service'
import { updateSgsScoreColumnFormula } from '@/services/sgs-score-workspace-service'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  DEFAULT_SGS_SCORE_CALCULATION_MISSING_POLICY,
  DEFAULT_SGS_SCORE_CALCULATION_ROUNDING,
  SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL,
  SGS_SCORE_CALCULATION_MODE_LABEL,
  SGS_SCORE_CALCULATION_ROUNDING_LABEL,
} from '@/types/sgs-score-calculation'
import type {
  SgsScoreCalculationFormula,
  SgsScoreCalculationGroup,
  SgsScoreCalculationMissingPolicy,
  SgsScoreCalculationMode,
  SgsScoreCalculationPreview,
  SgsScoreCalculationRounding,
  SgsScoreCalculationSource,
  SgsScoreCalculationWeight,
} from '@/types/sgs-score-calculation'
import type { SgsScoreColumn } from '@/types/sgs-score-workspace'
import type { ClassroomStudent } from '@/types/student'

interface ScoreCalculationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  classroomId: string
  targetColumn: SgsScoreColumn
  /** The column's saved formula, if any — fetched by the tab SEPARATELY
   * from targetColumn itself (see sgs-score-workspace-service.ts's
   * getSgsScoreColumnFormulas: targetColumn.calculationFormula is never
   * populated by the base workspace load, on purpose, so that load can
   * never fail because this optional data isn't available). `null` means
   * either "no formula saved yet" or "couldn't be loaded" — both cases
   * just start the form empty, never an error. */
  existingFormula: SgsScoreCalculationFormula | null
  students: ClassroomStudent[]
  /** This column's CURRENT scores, keyed by studentId — used only for
   * the "ช่องนี้มีคะแนนอยู่แล้ว X คน" / skip-existing-by-default rule
   * (section 10). Never used as a calculation source. */
  existingTargetScores: Record<string, number | null>
  /** Called after a successful save/apply so the tab can refetch and
   * show the new values/formula badge — this modal never mutates
   * anything in the parent directly. */
  onApplied: () => void | Promise<void>
}

/**
 * SGS SCORE CALCULATOR — a same-page overlay ONLY (see the spec's own
 * "SAME PAGE MODAL ONLY" requirement). This never renders a route, never
 * calls a navigation API, and closing it returns the teacher to exactly
 * the same คะแนน SGS table underneath (see score-calculation-modal test
 * item 20 in sgs-score-calculation-service.test.ts for the source-level
 * proof).
 *
 * Pipeline: raw assignment scores (getSgsScoreCalculationSources) ->
 * pure calculation (sgs-score-calculation-service.ts) -> this preview ->
 * teacher approval -> ONE sgs_score_columns column
 * (applySgsScoreCalculation, which is exactly setSgsScore under the
 * hood) -> the EXISTING, completely unmodified multi-column export ->
 * SGS Bridge v1.0.0. Nothing here ever touches sgs-bridge/, another SGS
 * column, assignment_submissions, attendance, or another subject/
 * classroom.
 */
export function ScoreCalculationModal({
  open,
  onOpenChange,
  subjectId,
  classroomId,
  targetColumn,
  existingFormula,
  students,
  existingTargetScores,
  onApplied,
}: ScoreCalculationModalProps) {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sources, setSources] = useState<SgsScoreCalculationSource[]>([])
  const [scoresByStudentIdAndAssignmentId, setScoresByStudentIdAndAssignmentId] = useState<Record<string, Record<string, number | null>>>({})

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [mode, setMode] = useState<SgsScoreCalculationMode>('proportional')
  const [groups, setGroups] = useState<SgsScoreCalculationGroup[]>([])
  const [weights, setWeights] = useState<SgsScoreCalculationWeight[]>([])
  const [missingPolicy, setMissingPolicy] = useState<SgsScoreCalculationMissingPolicy>(DEFAULT_SGS_SCORE_CALCULATION_MISSING_POLICY)
  const [rounding, setRounding] = useState<SgsScoreCalculationRounding>(DEFAULT_SGS_SCORE_CALCULATION_ROUNDING)

  const [preview, setPreview] = useState<SgsScoreCalculationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [overwriteExisting, setOverwriteExisting] = useState(false)
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false)
  const [savingFormula, setSavingFormula] = useState(false)
  const [applying, setApplying] = useState(false)
  /** The real underlying error from a failed/partial apply — shown only
   * in development (import.meta.env.DEV) so a teacher only ever sees the
   * friendly toast, while a developer diagnosing a live report sees the
   * exact function/message. Cleared on every new apply attempt; NEVER
   * used to decide whether the modal closes — that is decided purely by
   * whether the write itself succeeded (see doApply). */
  const [applyDiagnostic, setApplyDiagnostic] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    return getSgsScoreCalculationSources(subjectId, classroomId)
      .then(({ sources: loadedSources, scoresByStudentIdAndAssignmentId: loadedScores }) => {
        setSources(loadedSources)
        setScoresByStudentIdAndAssignmentId(loadedScores)

        const formula = existingFormula
        const availableIds = loadedSources.map((s) => s.assignmentId)
        if (formula && formula.mode === 'proportional') {
          setMode('proportional')
          setSelectedSourceIds(formula.sourceAssignmentIds.filter((id) => availableIds.includes(id)))
          setGroups([])
          setWeights([])
        } else if (formula && formula.mode === 'weighted_groups') {
          setMode('weighted_groups')
          setGroups(formula.groups)
          setSelectedSourceIds(Array.from(new Set(formula.groups.flatMap((g) => g.sourceAssignmentIds))).filter((id) => availableIds.includes(id)))
          setWeights([])
        } else if (formula && formula.mode === 'individual_weights') {
          setMode('individual_weights')
          setWeights(formula.weights)
          setSelectedSourceIds(formula.weights.map((w) => w.assignmentId).filter((id) => availableIds.includes(id)))
          setGroups([])
        } else {
          setMode('proportional')
          setSelectedSourceIds([])
          setGroups([])
          setWeights([])
        }
        if (formula) {
          setMissingPolicy(formula.missingScorePolicy)
          setRounding(formula.rounding)
        } else {
          setMissingPolicy(DEFAULT_SGS_SCORE_CALCULATION_MISSING_POLICY)
          setRounding(DEFAULT_SGS_SCORE_CALCULATION_ROUNDING)
        }
        setPreview(null)
        setPreviewError(null)
        setOverwriteExisting(false)
        setApplyDiagnostic(null)
      })
      .catch((err: unknown) => setLoadError(toFriendlyErrorMessage(err, 'โหลดคะแนนต้นทางไม่สำเร็จ')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-reading existingFormula deliberately only on (re)open, not on every parent re-render (e.g. while the tab's own refreshFormulas() resolves in the background)
  }, [subjectId, classroomId, targetColumn.id])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const selectedSources = useMemo(() => sources.filter((s) => selectedSourceIds.includes(s.assignmentId)), [sources, selectedSourceIds])
  const totalMaxOfSelected = selectedSources.reduce((sum, s) => sum + s.maxScore, 0)

  function toggleSource(assignmentId: string) {
    setPreview(null)
    setSelectedSourceIds((prev) => {
      const next = prev.includes(assignmentId) ? prev.filter((id) => id !== assignmentId) : [...prev, assignmentId]
      // Individual weights follows the checkbox list directly — keep the
      // weight rows in sync (new checks start at 0%, unchecked ones drop out).
      setWeights((w) => {
        if (!next.includes(assignmentId)) return w.filter((item) => item.assignmentId !== assignmentId)
        if (w.some((item) => item.assignmentId === assignmentId)) return w
        return [...w, { assignmentId, weightPercent: 0 }]
      })
      // Groups: an unchecked source is removed from every group it was in.
      setGroups((g) => (next.includes(assignmentId) ? g : g.map((group) => ({ ...group, sourceAssignmentIds: group.sourceAssignmentIds.filter((id) => id !== assignmentId) }))))
      return next
    })
  }

  function buildFormula(): SgsScoreCalculationFormula {
    const base = {
      targetColumnId: targetColumn.id,
      targetMaxScore: targetColumn.maxScore,
      missingScorePolicy: missingPolicy,
      rounding,
    }
    if (mode === 'proportional') return { ...base, mode: 'proportional', sourceAssignmentIds: selectedSourceIds }
    if (mode === 'weighted_groups') return { ...base, mode: 'weighted_groups', groups }
    return { ...base, mode: 'individual_weights', weights }
  }

  function handleComputePreview() {
    const formula = buildFormula()
    const validation = validateCalculationConfig(
      formula,
      sources.map((s) => s.assignmentId),
    )
    if (!validation.ok) {
      setPreviewError(validation.reason)
      setPreview(null)
      return
    }
    setPreviewError(null)
    const roster = students.map((s) => ({
      studentId: s.id,
      studentNumber: s.number,
      fullName: `${s.firstName} ${s.lastName}`.trim(),
    }))
    setPreview(calculateClassPreview(formula, roster, scoresByStudentIdAndAssignmentId, sources))
  }

  async function handleSaveFormula() {
    const formula = buildFormula()
    const validation = validateCalculationConfig(
      formula,
      sources.map((s) => s.assignmentId),
    )
    if (!validation.ok) {
      toast(validation.reason ?? 'ตั้งค่าการคำนวณยังไม่ถูกต้อง')
      return
    }
    setSavingFormula(true)
    try {
      await updateSgsScoreColumnFormula(targetColumn.id, formula)
      toast('บันทึกสูตรคำนวณแล้ว')
      await onApplied()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'บันทึกสูตรไม่สำเร็จ'))
    } finally {
      setSavingFormula(false)
    }
  }

  /**
   * REGRESSION FIX (live production incident): this used to write the
   * scores (applySgsScoreCalculation, which succeeds) and THEN save the
   * formula (updateSgsScoreColumnFormula) inside the SAME try block —
   * when the formula save failed (e.g. migration 0025 not yet applied
   * to this database), the thrown error was caught by the SAME catch as
   * a real score-write failure, so a successful score save was reported
   * to the teacher as "บันทึกคะแนนไม่สำเร็จ", the modal never closed,
   * and onApplied() (which would have shown the real saved values) was
   * never called — even though 32/32 scores had already been written.
   *
   * The score write is the ONE thing that decides success/failure here.
   * Saving the formula is optional metadata attempted afterward, in its
   * own try/catch, exactly like reading it already is (see
   * getSgsScoreColumnFormulas) — its failure is logged, never shown to
   * the teacher as a save failure, and never blocks anything below it.
   */
  async function doApply() {
    if (!preview) return
    setApplying(true)
    setApplyDiagnostic(null)
    try {
      const plan = planSgsScoreCalculationApply(preview, existingTargetScores, overwriteExisting)
      const totalToWrite = plan.filter((row) => row.action === 'write').length
      const { written, failed } = await applySgsScoreCalculation(targetColumn.id, plan)

      if (failed.length > 0) {
        // NEVER falsely reported as success — some/all rows failed to
        // persist. Refresh anyway so the teacher sees exactly which
        // students DID save, keep the modal open (preview + settings
        // preserved) so they can retry after the underlying issue is
        // fixed, and surface the real error for diagnosis.
        setApplyDiagnostic(`applySgsScoreCalculation: ${failed.length}/${totalToWrite} แถวบันทึกไม่สำเร็จ — ${failed.map((f) => `${f.studentId}: ${f.message}`).join(' | ')}`)
        toast(
          written > 0
            ? `บันทึกคะแนนสำเร็จบางส่วน (${written}/${totalToWrite} คน) — มี ${failed.length} คนบันทึกไม่สำเร็จ กรุณาลองใหม่`
            : 'บันทึกคะแนนไม่สำเร็จ',
        )
        await onApplied()
        return
      }

      // The scores themselves are saved — this is success. Saving the
      // formula is a best-effort side effect from here on; it must
      // never turn this into a failure.
      try {
        await updateSgsScoreColumnFormula(targetColumn.id, buildFormula())
      } catch (formulaErr) {
        setApplyDiagnostic(`updateSgsScoreColumnFormula: ${formulaErr instanceof Error ? formulaErr.message : String(formulaErr)} (คะแนนบันทึกสำเร็จแล้ว — ไม่กระทบผลลัพธ์)`)
      }

      toast('บันทึกคะแนนคำนวณแล้ว')
      onOpenChange(false)
      await onApplied()
    } catch (err) {
      // A structural failure BEFORE any row was even attempted (e.g.
      // planSgsScoreCalculationApply itself, or applySgsScoreCalculation
      // rejecting outright) — same rule: never claim success, keep the
      // modal open, surface the real error for diagnosis.
      setApplyDiagnostic(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
      toast(toFriendlyErrorMessage(err, 'บันทึกคะแนนไม่สำเร็จ'))
    } finally {
      setApplying(false)
      setConfirmOverwriteOpen(false)
    }
  }

  function handleApplyClick() {
    if (!preview) return
    if (overwriteExisting) {
      setConfirmOverwriteOpen(true)
      return
    }
    void doApply()
  }

  function addGroup() {
    setPreview(null)
    setGroups((prev) => [...prev, { id: `g${prev.length}-${Date.now()}`, label: `กลุ่มที่ ${prev.length + 1}`, weightPercent: 0, sourceAssignmentIds: [] }])
  }
  function removeGroup(id: string) {
    setPreview(null)
    setGroups((prev) => prev.filter((g) => g.id !== id))
  }
  function updateGroup(id: string, patch: Partial<SgsScoreCalculationGroup>) {
    setPreview(null)
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }
  function toggleGroupSource(groupId: string, assignmentId: string) {
    setPreview(null)
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              sourceAssignmentIds: g.sourceAssignmentIds.includes(assignmentId)
                ? g.sourceAssignmentIds.filter((id) => id !== assignmentId)
                : [...g.sourceAssignmentIds, assignmentId],
            }
          : g,
      ),
    )
  }
  function updateWeight(assignmentId: string, weightPercent: number) {
    setPreview(null)
    setWeights((prev) => prev.map((w) => (w.assignmentId === assignmentId ? { ...w, weightPercent } : w)))
  }

  const existingCount = countExistingTargetScores(existingTargetScores)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>คำนวณคะแนนสำหรับช่อง {targetColumn.label}</DialogTitle>
            <DialogDescription>คะแนนเต็ม SGS: {targetColumn.maxScore} คะแนน</DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลดคะแนนต้นทาง...</p>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : (
            <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
              {/* 1. เลือกคะแนนต้นทาง */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">1. เลือกคะแนนต้นทาง</h3>
                {sources.length === 0 ? (
                  <p className="text-xs text-muted-foreground">วิชา/ห้องนี้ยังไม่มีงาน/แบบทดสอบที่ให้คะแนนไว้</p>
                ) : (
                  <div className="rounded-lg border border-border">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setSelectedSourceIds(sources.map((s) => s.assignmentId))}>
                        เลือกทั้งหมด
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedSourceIds([])}>
                        ยกเลิกทั้งหมด
                      </Button>
                      <span className="ml-auto text-xs text-muted-foreground">
                        เลือกแล้ว <span className="font-semibold text-foreground">{selectedSourceIds.length}</span> รายการ · คะแนนเต็มรวม{' '}
                        <span className="font-semibold text-foreground">{totalMaxOfSelected}</span> คะแนน
                      </span>
                    </div>
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="px-3 py-1.5 font-medium">คะแนนต้นทาง</th>
                          <th className="px-3 py-1.5 font-medium">เต็ม</th>
                          {mode === 'individual_weights' && <th className="px-3 py-1.5 font-medium">น้ำหนัก (%)</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {sources.map((source) => {
                          const checked = selectedSourceIds.includes(source.assignmentId)
                          const weightRow = weights.find((w) => w.assignmentId === source.assignmentId)
                          return (
                            <tr key={source.assignmentId} className="border-t border-border">
                              <td className="px-3 py-1.5">
                                <label className="flex cursor-pointer items-center gap-2">
                                  <input type="checkbox" checked={checked} onChange={() => toggleSource(source.assignmentId)} className="size-4" />
                                  {source.label}
                                </label>
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">{source.maxScore}</td>
                              {mode === 'individual_weights' && (
                                <td className="px-3 py-1.5">
                                  {checked && (
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={weightRow?.weightPercent ?? 0}
                                      onChange={(e) => updateWeight(source.assignmentId, Number(e.target.value))}
                                      className="h-7 w-20 text-right"
                                    />
                                  )}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 2. วิธีคำนวณ */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">2. วิธีคำนวณ</h3>
                <div className="space-y-1.5">
                  {(['proportional', 'weighted_groups', 'individual_weights'] as SgsScoreCalculationMode[]).map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="calc-mode"
                        checked={mode === m}
                        onChange={() => {
                          setMode(m)
                          setPreview(null)
                          if (m === 'individual_weights') {
                            setWeights(selectedSourceIds.map((id) => weights.find((w) => w.assignmentId === id) ?? { assignmentId: id, weightPercent: 0 }))
                          }
                        }}
                        className="size-4"
                      />
                      {SGS_SCORE_CALCULATION_MODE_LABEL[m]}
                    </label>
                  ))}
                </div>

                {mode === 'weighted_groups' && (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    {groups.map((group) => (
                      <div key={group.id} className="space-y-1.5 rounded-md border border-border p-2">
                        <div className="flex items-center gap-2">
                          <Input value={group.label} onChange={(e) => updateGroup(group.id, { label: e.target.value })} className="h-7 flex-1" />
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={group.weightPercent}
                            onChange={(e) => updateGroup(group.id, { weightPercent: Number(e.target.value) })}
                            className="h-7 w-20 text-right"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                          <button type="button" onClick={() => removeGroup(group.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1">
                          {selectedSources.map((source) => (
                            <label key={source.assignmentId} className="flex cursor-pointer items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={group.sourceAssignmentIds.includes(source.assignmentId)}
                                onChange={() => toggleGroupSource(group.id, source.assignmentId)}
                                className="size-3.5"
                              />
                              {source.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" onClick={addGroup}>
                      <Plus className="size-3.5" />
                      เพิ่มกลุ่ม
                    </Button>
                    <p className="text-xs text-muted-foreground">น้ำหนักรวมของทุกกลุ่มต้องเท่ากับ 100%</p>
                  </div>
                )}
                {mode === 'individual_weights' && <p className="text-xs text-muted-foreground">กำหนดน้ำหนัก % ในตารางด้านบน — น้ำหนักรวมต้องเท่ากับ 100%</p>}
              </section>

              {/* 3. กรณีไม่มีคะแนน */}
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">3. เมื่อนักเรียนไม่มีคะแนนบางรายการ</h3>
                {(['treat_as_zero', 'exclude'] as SgsScoreCalculationMissingPolicy[]).map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="missing-policy" checked={missingPolicy === p} onChange={() => { setMissingPolicy(p); setPreview(null) }} className="size-4" />
                    {SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL[p]}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">
                  คะแนน 0 ถือเป็นคะแนนจริงเสมอ ไม่ใช่ "ไม่มีคะแนน" ไม่ว่าจะเลือกตัวเลือกใด
                </p>
              </section>

              {/* 4. การปัดคะแนน */}
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">4. การปัดคะแนน</h3>
                {(['none', 'one_decimal', 'two_decimal', 'integer'] as SgsScoreCalculationRounding[]).map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="rounding" checked={rounding === r} onChange={() => { setRounding(r); setPreview(null) }} className="size-4" />
                    {SGS_SCORE_CALCULATION_ROUNDING_LABEL[r]}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">คะแนนที่คำนวณได้จะไม่มีวันเกินคะแนนเต็มของช่อง — หากเกิดขึ้นจะถูกระงับและแจ้งเหตุผลแทนการปัดทิ้ง</p>
              </section>

              <Button type="button" onClick={handleComputePreview}>
                คำนวณตัวอย่าง
              </Button>
              {previewError && <p className="text-sm text-destructive">{previewError}</p>}

              {preview && (
                <section className="space-y-3 border-t border-border pt-3">
                  <h3 className="text-sm font-semibold">ภาพรวมทั้งห้อง</h3>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span>
                      นักเรียนทั้งหมด <span className="font-semibold">{preview.summary.totalStudents}</span> คน
                    </span>
                    <span>
                      คำนวณได้ <span className="font-semibold">{preview.summary.calculable}</span> คน
                    </span>
                    {preview.summary.missingData > 0 && (
                      <span className="text-destructive">
                        ⚠ ข้อมูลไม่ครบ <span className="font-semibold">{preview.summary.missingData}</span> คน
                      </span>
                    )}
                    {preview.summary.average !== null && (
                      <span>
                        เฉลี่ย <span className="font-semibold">{preview.summary.average.toFixed(1)}</span>
                      </span>
                    )}
                    {preview.summary.highest !== null && (
                      <span>
                        สูงสุด <span className="font-semibold">{preview.summary.highest.toFixed(1)}</span>
                      </span>
                    )}
                    {preview.summary.lowest !== null && (
                      <span>
                        ต่ำสุด <span className="font-semibold">{preview.summary.lowest.toFixed(1)}</span>
                      </span>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-muted/60">
                        <tr>
                          <th className="border-b border-border px-3 py-2 font-medium">เลขที่</th>
                          <th className="border-b border-border px-3 py-2 font-medium">นักเรียน</th>
                          <th className="border-b border-border px-3 py-2 font-medium">คะแนนที่ใช้</th>
                          <th className="border-b border-border px-3 py-2 font-medium">ร้อยละ</th>
                          <th className="border-b border-border px-3 py-2 font-medium">คะแนน SGS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row) => (
                          <tr key={row.studentId} className="border-t border-border">
                            <td className="px-3 py-1.5">{row.studentNumber ?? '-'}</td>
                            <td className="px-3 py-1.5">{row.fullName}</td>
                            {row.result.status === 'ok' ? (
                              <>
                                <td className="px-3 py-1.5">
                                  {row.result.usedTotal}/{row.result.usedMax}
                                </td>
                                <td className="px-3 py-1.5">{Math.round(row.result.percent)}%</td>
                                <td className="px-3 py-1.5 font-medium">
                                  {row.result.calculatedScore}/{targetColumn.maxScore}
                                </td>
                              </>
                            ) : (
                              <td colSpan={3} className="px-3 py-1.5 text-destructive">
                                ⚠ {row.result.reason === 'missing_data' ? 'ข้อมูลไม่ครบ' : 'คะแนนไม่ถูกต้อง'} — {row.result.message}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {existingCount > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-sm">
                        ช่อง "{targetColumn.label}" มีคะแนนอยู่แล้ว <span className="font-semibold">{existingCount}</span> คน
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={overwriteExisting}
                          onChange={(e) => setOverwriteExisting(e.target.checked)}
                          className="size-4"
                        />
                        เขียนทับคะแนนเดิม (ค่าเริ่มต้น: เขียนเฉพาะนักเรียนที่ช่องนี้ยังว่าง)
                      </label>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* Development-only diagnostic — the teacher only ever sees the
           * friendly toast; this exposes the real function/error for
           * whoever is debugging a live save failure, never for normal
           * teacher use (see doApply's own doc comment). */}
          {applyDiagnostic && import.meta.env.DEV && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              [DEV] {applyDiagnostic}
            </pre>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleSaveFormula()} disabled={savingFormula || loading}>
              บันทึกสูตร
            </Button>
            <Button type="button" onClick={handleApplyClick} disabled={!preview || applying}>
              ✓ ใช้คะแนนชุดนี้กับช่อง {targetColumn.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOverwriteOpen}
        onOpenChange={setConfirmOverwriteOpen}
        title="เขียนทับคะแนนเดิม?"
        description={`ช่อง "${targetColumn.label}" มีคะแนนอยู่แล้ว ${existingCount} คน — การยืนยันจะเขียนทับคะแนนเดิมของนักเรียนกลุ่มนี้ด้วยคะแนนที่คำนวณใหม่`}
        confirmLabel="ยืนยันเขียนทับ"
        destructive
        onConfirm={doApply}
      />
    </>
  )
}
