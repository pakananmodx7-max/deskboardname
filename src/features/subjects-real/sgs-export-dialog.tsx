import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { downloadCsv } from '@/lib/export/csv-export'
import { downloadJson } from '@/lib/export/json-export'
import {
  buildSgsBridgePayload,
  buildSgsExportCsvTable,
  buildSgsExportRows,
  computeSgsExportSummary,
  validateSgsBridgePayload,
} from '@/services/sgs-export-service'
import type { AssignmentSubmission } from '@/types/assignment'
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
  maxScore: number
  roster: ClassroomStudent[]
  submissions: Record<string, AssignmentSubmission>
}

/**
 * "ส่งคะแนนไป SGS" — SGS integration Phase 2/7 (see the SGS Bridge
 * prototype plan). This dialog is READ-ONLY and NEVER talks to SGS: it
 * only previews exactly what would transfer, using the SAME
 * assignment_submissions.score data already on screen (no extra
 * fetch), and offers a CSV snapshot or a downloaded bridge-payload JSON
 * file the teacher loads into the local SGS Bridge Chrome extension by
 * hand. There is no code path here (or anywhere in this phase) that
 * reaches the SGS website — that only happens later, from inside the
 * extension, and even there stops before the final Save (see
 * sgs-bridge/README.md).
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
  maxScore,
  roster,
  submissions,
}: SgsExportDialogProps) {
  const { toast } = useToast()

  const rows = useMemo(() => buildSgsExportRows(roster, submissions), [roster, submissions])
  const summary = useMemo(() => computeSgsExportSummary(rows, maxScore), [rows, maxScore])

  function handleDownloadCsv() {
    const table = buildSgsExportCsvTable(subjectName, classroomName, assignmentTitle, maxScore, rows)
    downloadCsv(table, `sgs-${assignmentTitle}-${classroomName}`)
  }

  function handlePrepareBridgePayload() {
    const payload = buildSgsBridgePayload(
      { subjectId, subjectName, classroomId, classroomName, assignmentId, assignmentTitle, maxScore },
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
    downloadJson(payload, `sgs-bridge-${assignmentTitle}-${classroomName}`)
    toast('ดาวน์โหลดไฟล์สำหรับ SGS Bridge แล้ว — เปิด Chrome Extension เพื่อโหลดไฟล์นี้ต่อ')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ส่งคะแนนไป SGS</DialogTitle>
          <DialogDescription>
            รายวิชา: {subjectName} · ห้อง: {classroomName} · งาน: {assignmentTitle} · คะแนนเต็ม: {maxScore}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            นักเรียนทั้งหมด <span className="font-semibold text-foreground">{summary.totalStudents}</span> คน
          </span>
          <span>
            มีคะแนน <span className="font-semibold text-foreground">{summary.withScore}</span> คน
          </span>
          <span>
            ไม่ส่ง (ยังไม่มีคะแนน) <span className="font-semibold text-foreground">{summary.skipped}</span> คน
          </span>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                <th className="border-b border-border px-3 py-2 font-medium">เลขที่</th>
                <th className="border-b border-border px-3 py-2 font-medium">นักเรียน</th>
                <th className="border-b border-border px-3 py-2 font-medium">คะแนน KrunameClass</th>
                <th className="border-b border-border px-3 py-2 font-medium">ส่งไป SGS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.studentId}>
                  <td className="border-b border-border px-3 py-2">{row.studentNumber ?? '-'}</td>
                  <td className="border-b border-border px-3 py-2">{row.fullName}</td>
                  <td className="border-b border-border px-3 py-2">{row.krunameScore ?? '—'}</td>
                  <td className="border-b border-border px-3 py-2">
                    {row.willSend ? row.krunameScore : <span className="text-muted-foreground">ไม่ส่ง</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          ขั้นตอนนี้เป็นการดูตัวอย่างเท่านั้น ยังไม่มีการส่งคะแนนไป SGS โดยอัตโนมัติ
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button type="button" variant="outline" onClick={handleDownloadCsv}>
            ดาวน์โหลด CSV
          </Button>
          <Button type="button" onClick={handlePrepareBridgePayload}>
            เตรียมส่งผ่าน SGS Bridge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
