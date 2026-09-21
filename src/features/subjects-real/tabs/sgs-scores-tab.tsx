import { Plus, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { parseScoreInput } from '@/services/assignment-service'
import {
  buildSgsScoreWorkspaceMultiPayload,
  buildSgsScoreWorkspacePayload,
  buildSgsScoreWorkspaceRows,
  computeSgsScoreWorkspaceSendPlan,
  createSgsScoreColumn,
  deleteSgsScoreColumn,
  getSgsScoreColumns,
  getSgsScores,
  setSgsScore,
  validateSgsScoreWorkspaceMultiPayload,
  validateSgsScoreWorkspacePayload,
} from '@/services/sgs-score-workspace-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { downloadJson } from '@/lib/export/json-export'
import { cn } from '@/lib/utils'
import type { SgsScoreColumn } from '@/types/sgs-score-workspace'
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
  const [scoresByColumnId, setScoresByColumnId] = useState<Record<string, Record<string, number | null>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetTicks, setResetTicks] = useState<Record<string, number>>({})

  const [newColumnLabel, setNewColumnLabel] = useState('')
  const [newColumnMaxScore, setNewColumnMaxScore] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)

  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [targetColumnId, setTargetColumnId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return Promise.all([getSgsScoreColumns(subjectId, classroomId), getStudentsByClassroom(classroomId)])
      .then(async ([columnRows, studentRows]) => {
        setColumns(columnRows)
        setStudents(studentRows)
        const scoreRows = await Promise.all(columnRows.map((c) => getSgsScores(c.id)))
        const next: Record<string, Record<string, number | null>> = {}
        columnRows.forEach((c, i) => {
          next[c.id] = scoreRows[i]
        })
        setScoresByColumnId(next)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subjectId, classroomId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(
    () => buildSgsScoreWorkspaceRows(students, columns, scoresByColumnId),
    [students, columns, scoresByColumnId],
  )

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
      await refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบคอลัมน์ได้'))
    }
  }

  async function handleScoreBlur(column: SgsScoreColumn, studentId: string, raw: string) {
    const cellKey = `${column.id}:${studentId}`
    const { value: score, error: validationError } = parseScoreInput(raw, column.maxScore)
    if (validationError) {
      toast(validationError)
      setResetTicks((prev) => ({ ...prev, [cellKey]: (prev[cellKey] ?? 0) + 1 }))
      return
    }
    try {
      await setSgsScore(column.id, studentId, score)
      setScoresByColumnId((prev) => ({
        ...prev,
        [column.id]: { ...prev[column.id], [studentId]: score },
      }))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
      setResetTicks((prev) => ({ ...prev, [cellKey]: (prev[cellKey] ?? 0) + 1 }))
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
   * PRODUCTION multi-column export — one file carrying EVERY column in
   * this workspace plus each student's score per column, for the
   * extension's production workflow (select several SGS columns, send
   * them in one run). The single-column export above is unchanged and
   * still available.
   */
  function handleDownloadMultiPayload() {
    if (columns.length === 0) return
    const payload = buildSgsScoreWorkspaceMultiPayload(
      {
        subjectId,
        subjectName,
        classroomId,
        classroomName,
        columns: columns.map((column) => ({ key: column.id, label: column.label, maxScore: column.maxScore })),
      },
      rows,
    )
    const validation = validateSgsScoreWorkspaceMultiPayload(payload)
    if (!validation.ok) {
      toast('ไม่สามารถเตรียมข้อมูลได้ กรุณาลองใหม่')
      return
    }
    downloadJson(payload, `sgs-bridge-ทุกช่อง-${classroomName}`)
    toast('ดาวน์โหลดไฟล์ทุกช่องคะแนนแล้ว — เปิด Chrome Extension เพื่อโหลดไฟล์นี้ต่อ')
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        ตารางนี้แยกออกจากคะแนนงาน (ตรวจงานและคะแนน) โดยสิ้นเชิง — คอลัมน์แต่ละอันมิเรอร์ช่องคะแนนจริงในระบบ SGS
        (ยืนยันด้วยการตรวจสอบโครงสร้างหน้า SGS จาก Chrome Extension) การกรอกคะแนนที่นี่ไม่มีผลต่อคะแนนงานใด ๆ
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

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
                        const score = row.scoresByColumnId[column.id] ?? null
                        const cellKey = `${column.id}:${row.studentId}`
                        return (
                          <td key={column.id} className="px-3 py-2 text-center">
                            <Input
                              type="number"
                              min={0}
                              max={column.maxScore}
                              defaultValue={score ?? ''}
                              placeholder="—"
                              key={`${cellKey}-${score}-${resetTicks[cellKey] ?? 0}`}
                              onBlur={(e) => handleScoreBlur(column, row.studentId, e.target.value)}
                              className="mx-auto h-8 w-16 text-center"
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
            <legend className="px-1 text-sm font-medium">เลือกช่องคะแนน SGS (เลือกได้ทีละ 1 ช่อง)</legend>
            {columns.map((column) => (
              <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <input
                  type="radio"
                  name="sgs-workspace-target-column"
                  value={column.id}
                  checked={targetColumnId === column.id}
                  onChange={() => setTargetColumnId(column.id)}
                  className="size-4"
                />
                {column.label} — เต็ม {column.maxScore}
              </label>
            ))}
          </fieldset>

          {targetColumn && (
            <>
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
            Chrome Extension เพื่อดำเนินการต่อ (โหมดทดสอบ 1 คน)
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSendDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" variant="outline" onClick={handleDownloadMultiPayload} disabled={columns.length === 0}>
              ดาวน์โหลดทุกช่องคะแนน ({columns.length})
            </Button>
            <Button type="button" onClick={handleDownloadPayload} disabled={!targetColumn}>
              ดาวน์โหลด Bridge Payload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
