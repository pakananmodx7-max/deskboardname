import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { downloadCsv } from '@/lib/export/csv-export'
import { downloadJson } from '@/lib/export/json-export'
import {
  SGS_COLUMNS,
  buildSgsBridgePayload,
  buildSgsColumnFillCsvTable,
  buildSgsExportRows,
  computeSgsColumnFillPlan,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
  validateSgsBridgePayload,
} from '@/services/sgs-export-service'
import type { AssignmentSubmission } from '@/types/assignment'
import { DEFAULT_SGS_OVERWRITE_MODE, type SgsOverwriteMode } from '@/types/sgs-bridge'
import type { ClassroomStudent } from '@/types/student'

interface SgsExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  assignmentId: string
  assignmentTitle: string
  assignmentMaxScore: number
  roster: ClassroomStudent[]
  submissions: Record<string, AssignmentSubmission>
}

/** KrunameClass has no live access to the teacher's other SGS tab, so
 * every row's "current SGS value" is unknown at this stage — always
 * treated as empty here (see computeSgsColumnFillPlan's own doc
 * comment on that distinction). This is why the preview below never
 * actually produces a 'skip_existing' row: that decision can only be
 * made for real once the extension reads the live page. */
const NO_KNOWN_EXISTING_SCORES: Record<string, number | null> = {}

/**
 * "ส่งคะแนนไป SGS" — SGS integration Phase 2/7, now column-specific: the
 * teacher must pick exactly ONE SGS score column (ช่อง 1/2/.../กลางภาค/
 * ปลายภาค) before anything is prepared, and every bridge payload this
 * dialog produces can only ever affect that one column — see
 * SgsColumnDefinition/targetColumn in src/types/sgs-bridge.ts.
 *
 * Still fully READ-ONLY and NEVER talks to SGS: it only previews what
 * would transfer, using the SAME assignment_submissions.score data
 * already on screen (no extra fetch), and offers a CSV snapshot or a
 * downloaded bridge-payload JSON file the teacher loads into the local
 * SGS Bridge Chrome extension by hand.
 */
export function SgsExportDialog({
  open,
  onOpenChange,
  subjectId,
  subjectName,
  classroomId,
  classroomName,
  assignmentId,
  assignmentTitle,
  assignmentMaxScore,
  roster,
  submissions,
}: SgsExportDialogProps) {
  const { toast } = useToast()
  const [targetColumnKey, setTargetColumnKey] = useState<string | null>(null)
  const [overwriteMode, setOverwriteMode] = useState<SgsOverwriteMode>(DEFAULT_SGS_OVERWRITE_MODE)

  const targetColumn = SGS_COLUMNS.find((c) => c.key === targetColumnKey) ?? null

  const rows = useMemo(() => buildSgsExportRows(roster, submissions), [roster, submissions])
  const plan = useMemo(
    () => computeSgsColumnFillPlan(rows, NO_KNOWN_EXISTING_SCORES, overwriteMode),
    [rows, overwriteMode],
  )
  const willWriteCount = plan.filter((r) => r.action === 'write').length
  const skippedNoScoreCount = plan.filter((r) => r.action === 'skip_no_score').length

  function handleDownloadCsv() {
    if (!targetColumn) return
    const table = buildSgsColumnFillCsvTable(subjectName, classroomName, assignmentTitle, targetColumn, plan)
    downloadCsv(table, `sgs-${targetColumn.label}-${assignmentTitle}-${classroomName}`)
  }

  function handlePrepareBridgePayload() {
    if (!targetColumn) return
    const payload = buildSgsBridgePayload(
      {
        subjectId,
        subjectName,
        classroomId,
        classroomName,
        assignmentId,
        assignmentTitle,
        assignmentMaxScore,
        targetColumn,
        overwriteMode,
      },
      rows,
    )
    const validation = validateSgsBridgePayload(payload)
    if (!validation.ok) {
      // Should never happen — buildSgsBridgePayload only ever produces a
      // shape validateSgsBridgePayload accepts — but this dialog never
      // hands a file to the extension without re-checking it first,
      // exactly like the extension itself will on load.
      toast('ไม่สามารถเตรียมข้อมูลได้ กรุณาลองใหม่')
      return
    }
    downloadJson(payload, `sgs-bridge-${targetColumn.label}-${assignmentTitle}-${classroomName}`)
    toast('ดาวน์โหลดไฟล์สำหรับ SGS Bridge แล้ว — เปิด Chrome Extension เพื่อโหลดไฟล์นี้ต่อ')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ส่งคะแนนไป SGS</DialogTitle>
          <DialogDescription>
            รายวิชา: {subjectName} · ห้อง: {classroomName} · งาน: {assignmentTitle}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-1.5 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">เลือกช่องคะแนน SGS</legend>
          {SGS_COLUMNS.map((col) => (
            <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <input
                type="radio"
                name="sgs-target-column"
                value={col.key}
                checked={targetColumnKey === col.key}
                onChange={() => setTargetColumnKey(col.key)}
                className="size-4"
              />
              {col.label} — เต็ม {col.maxScore}
            </label>
          ))}
        </fieldset>

        {targetColumn && (
          <>
            <fieldset className="space-y-1.5 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">หากช่อง "{targetColumn.label}" มีคะแนนเดิมอยู่แล้ว</legend>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <input
                  type="radio"
                  name="sgs-overwrite-mode"
                  value="skip_existing"
                  checked={overwriteMode === 'skip_existing'}
                  onChange={() => setOverwriteMode('skip_existing')}
                  className="size-4"
                />
                ข้ามคะแนนที่มีอยู่แล้ว
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <input
                  type="radio"
                  name="sgs-overwrite-mode"
                  value="overwrite_selected_column"
                  checked={overwriteMode === 'overwrite_selected_column'}
                  onChange={() => setOverwriteMode('overwrite_selected_column')}
                  className="size-4"
                />
                เขียนทับเฉพาะช่องที่เลือก
              </label>
              <p className="px-2 text-xs text-muted-foreground">
                มีผลเฉพาะช่อง "{targetColumn.label}" เท่านั้น — ช่องอื่นในหน้า SGS จะไม่ถูกแตะต้องไม่ว่าเลือกโหมดใด
                การตรวจสอบคะแนนเดิมจริงเกิดขึ้นที่ Chrome Extension เมื่ออ่านหน้า SGS ได้แล้ว
              </p>
            </fieldset>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span>
                นักเรียนทั้งหมด <span className="font-semibold text-foreground">{rows.length}</span> คน
              </span>
              <span>
                จะส่ง <span className="font-semibold text-foreground">{willWriteCount}</span> คน
              </span>
              <span>
                ข้าม (ไม่มีคะแนน) <span className="font-semibold text-foreground">{skippedNoScoreCount}</span> คน
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              KrunameClass ยังไม่สามารถอ่านคะแนนเดิมจากหน้า SGS ได้โดยตรงในขั้นตอนนี้ คอลัมน์ "คะแนนเดิม SGS"
              ด้านล่างจึงแสดงเป็นว่างเสมอ — ระบบจะตรวจสอบคะแนนเดิมจริงอีกครั้งที่ Chrome Extension ก่อนเขียนค่าใด ๆ
              ตามโหมดที่เลือกไว้ข้างต้น
            </p>

            <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
              <table className="w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    <th className="border-b border-border px-3 py-2 font-medium">เลขที่</th>
                    <th className="border-b border-border px-3 py-2 font-medium">นักเรียน</th>
                    <th className="border-b border-border px-3 py-2 font-medium">คะแนน KrunameClass</th>
                    <th className="border-b border-border px-3 py-2 font-medium">คะแนนเดิม SGS</th>
                    <th className="border-b border-border px-3 py-2 font-medium">คะแนนใหม่</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((row) => (
                    <tr key={row.studentId}>
                      <td className="border-b border-border px-3 py-2">{row.studentNumber ?? '-'}</td>
                      <td className="border-b border-border px-3 py-2">{row.fullName}</td>
                      <td className="border-b border-border px-3 py-2">{row.krunameScore ?? '—'}</td>
                      <td className="border-b border-border px-3 py-2">{formatSgsExistingScoreDisplay(row.sgsExistingScore)}</td>
                      <td className="border-b border-border px-3 py-2">
                        {row.action === 'write' ? (
                          formatSgsNewValueDisplay(row)
                        ) : (
                          <span className="text-muted-foreground">{formatSgsNewValueDisplay(row)}</span>
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
          ขั้นตอนนี้เป็นการดูตัวอย่างเท่านั้น ยังไม่มีการส่งคะแนนไป SGS โดยอัตโนมัติ
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button type="button" variant="outline" onClick={handleDownloadCsv} disabled={!targetColumn}>
            ดาวน์โหลด CSV
          </Button>
          <Button type="button" onClick={handlePrepareBridgePayload} disabled={!targetColumn}>
            เตรียมส่งผ่าน SGS Bridge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
