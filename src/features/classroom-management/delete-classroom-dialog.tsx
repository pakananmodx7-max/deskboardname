import { AlertTriangle, FileWarning, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  ClassroomLifecycleError,
  deleteClassroomPermanently,
  getClassroomDeletionPreview,
  type ClassroomDeletionResult,
} from '@/services/classroom-lifecycle-service'

import {
  canDelete,
  deletedRows,
  fileRows,
  hasFiles,
  isConfirmationNameMatch,
  preservedRows,
  totalDeletedRecords,
  type ClassroomDeletionPreview,
  type CountRow,
} from './classroom-deletion-model'

type Step = 'loading' | 'load-error' | 'review' | 'final' | 'deleting'

interface DeleteClassroomDialogProps {
  /** The classroom to delete; null closes the dialog. */
  classroom: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
  /** Called only after the server confirmed the deletion. */
  onDeleted: (result: ClassroomDeletionResult, classroomName: string) => void
}

const nf = new Intl.NumberFormat('th-TH')

/** Refusals that mean "look again" rather than "try again". */
const RECHECK_KINDS: ReadonlySet<ClassroomLifecycleError['kind']> = new Set(['stale', 'name_mismatch', 'blocked', 'not_archived'])

/**
 * "ลบห้องเรียนถาวร" — separate from archiving on purpose. Three gates
 * before anything is deleted: (1) a live preview of every affected
 * record from the server, (2) typing the exact classroom name, (3) a
 * second, final confirmation. The server re-checks all of it
 * (delete_classroom_permanently, 0032) and deletes in one transaction.
 */
export function DeleteClassroomDialog({ classroom, onOpenChange, onDeleted }: DeleteClassroomDialogProps) {
  // Keyed by classroom: every opening starts from a clean state.
  return classroom ? <DeleteClassroomDialogBody key={classroom.id} classroom={classroom} onOpenChange={onOpenChange} onDeleted={onDeleted} /> : null
}

function DeleteClassroomDialogBody({ classroom, onOpenChange, onDeleted }: DeleteClassroomDialogProps & { classroom: { id: string; name: string } }) {
  const [step, setStep] = useState<Step>('loading')
  const [preview, setPreview] = useState<ClassroomDeletionPreview | null>(null)
  const [typedName, setTypedName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const classroomId = classroom.id

  const applyPreview = useCallback((result: Promise<ClassroomDeletionPreview>) => {
    return result.then(
      (fresh) => {
        setPreview(fresh)
        setStep('review')
      },
      (err: unknown) => {
        setPreview(null)
        setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ')
        setStep('load-error')
      },
    )
  }, [])

  const loadPreview = useCallback(
    async (id: string) => {
      setStep('loading')
      setError(null)
      await applyPreview(getClassroomDeletionPreview(id))
    },
    [applyPreview],
  )

  useEffect(() => {
    void applyPreview(getClassroomDeletionPreview(classroomId))
  }, [classroomId, applyPreview])

  async function handleDelete() {
    if (!preview) return
    setStep('deleting')
    setError(null)
    try {
      const result = await deleteClassroomPermanently(classroom.id, typedName, preview.fingerprint)
      onDeleted(result, preview.classroom.name)
    } catch (err) {
      const lifecycle = err instanceof ClassroomLifecycleError ? err : null
      if (lifecycle && RECHECK_KINDS.has(lifecycle.kind)) {
        // The data, the name or the archive state changed since the
        // preview: nothing was deleted — show the fresh state and ask again.
        setNotice(`ยังไม่ได้ลบ — ${lifecycle.message}`)
        setTypedName('')
        await loadPreview(classroom.id)
        return
      }
      setError(`ยังไม่ได้ลบ — ${err instanceof Error ? err.message : 'ลบห้องเรียนไม่สำเร็จ'}`)
      setStep('final')
    }
  }

  const busy = step === 'deleting'
  const nameMatches = preview ? isConfirmationNameMatch(typedName, preview.classroom.name) : false
  const deletable = preview ? canDelete(preview) : false
  const total = preview ? totalDeletedRecords(preview.counts) : 0

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-w-xl max-md:max-h-[92vh] max-md:w-[calc(100%-1.5rem)] max-md:p-4"
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-4" />
            ลบห้องเรียนถาวร
          </DialogTitle>
          <DialogDescription>
            ห้อง <span className="font-semibold text-foreground">“{preview?.classroom.name ?? classroom.name}”</span>
            {' '}จะถูกลบพร้อมข้อมูลของห้องนี้ และ<strong className="text-destructive">กู้คืนไม่ได้</strong> — ถ้าเพียงต้องการนำออกจากรายการ ให้ใช้ “เก็บถาวร” แทน
          </DialogDescription>
        </DialogHeader>

        {step === 'loading' && (
          <div className="space-y-2" role="status" aria-label="กำลังตรวจสอบข้อมูลที่จะถูกลบ">
            <p className="text-sm text-muted-foreground">กำลังตรวจสอบข้อมูลที่จะถูกลบจากเซิร์ฟเวอร์...</p>
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          </div>
        )}

        {step === 'load-error' && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        {preview && (step === 'review' || step === 'final' || step === 'deleting') && (
          <div className="space-y-4">
            {notice && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground" role="alert">
                {notice}
              </p>
            )}

            {preview.blockers.length > 0 && (
              <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3" role="alert">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <AlertTriangle className="size-4" /> ยังลบห้องนี้ถาวรไม่ได้
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
                  {preview.blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {step === 'review' && (
              <>
                <CountSection
                  tone="danger"
                  title={total > 0 ? `จะถูกลบถาวร (${nf.format(total)} รายการ)` : 'จะถูกลบถาวร'}
                  rows={deletedRows(preview.counts)}
                  empty="ห้องนี้ไม่มีข้อมูลอื่น — จะลบเฉพาะตัวห้องเรียน"
                />
                <CountSection tone="safe" title="เก็บไว้ ไม่ถูกลบ" rows={preservedRows(preview.counts)} />
                <div className="space-y-1.5 rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <FileWarning className="size-4 text-warning" /> ไฟล์
                  </p>
                  <CountList rows={fileRows(preview.counts)} />
                  <p className="text-xs text-muted-foreground">
                    {hasFiles(preview.counts)
                      ? 'ระบบจะไม่ลบไฟล์ใด ๆ โดยอัตโนมัติ (รวมถึงไฟล์ใน Google Drive) — รายการไฟล์จะถูกบันทึกไว้ให้ผู้ดูแลระบบตรวจสอบและอนุมัติการลบแยกต่างหาก ไฟล์ที่ห้องอื่นยังใช้อยู่จะไม่ถูกลบ'
                      : 'ห้องนี้ไม่มีไฟล์แนบ'}
                  </p>
                </div>

                {deletable && (
                  <div className="space-y-1.5">
                    <label htmlFor="delete-classroom-name" className="text-sm font-medium text-foreground">
                      พิมพ์ชื่อห้องเรียน <span className="select-all rounded bg-muted px-1.5 py-0.5 font-mono">{preview.classroom.name}</span> เพื่อยืนยัน
                    </label>
                    <Input
                      id="delete-classroom-name"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      aria-invalid={typedName.length > 0 && !nameMatches}
                      placeholder={preview.classroom.name}
                    />
                    {typedName.length > 0 && !nameMatches && <p className="text-xs text-destructive">ชื่อยังไม่ตรง (ต้องตรงทุกตัวอักษร)</p>}
                  </div>
                )}
              </>
            )}

            {(step === 'final' || step === 'deleting') && (
              <div className="space-y-2 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4" role="alert">
                <p className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                  <AlertTriangle className="size-4" /> ยืนยันครั้งสุดท้าย
                </p>
                <p className="text-sm text-foreground">
                  ลบห้อง <strong>“{preview.classroom.name}”</strong> และข้อมูล <strong>{nf.format(total)} รายการ</strong> อย่างถาวร
                  — รวมการเช็คชื่อ {nf.format(preview.counts.attendance_records)} รายการ และคะแนน {nf.format(preview.counts.graded_submissions + preview.counts.sgs_scores)} รายการ
                </p>
                <p className="text-sm text-foreground">นักเรียน {nf.format(preview.counts.students)} คน และ QR ประจำตัวยังอยู่ครบ</p>
                <p className="text-sm font-semibold text-destructive">การลบนี้ย้อนกลับไม่ได้</p>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'load-error' && (
            <Button type="button" variant="outline" onClick={() => void loadPreview(classroomId)}>
              ลองใหม่
            </Button>
          )}
          {(step === 'final' || step === 'deleting') && (
            <Button type="button" variant="outline" onClick={() => setStep('review')} disabled={busy}>
              ย้อนกลับ
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            ยกเลิก
          </Button>
          {step === 'review' && deletable && (
            <Button type="button" variant="destructive" onClick={() => { setError(null); setStep('final') }} disabled={!nameMatches}>
              ถัดไป
            </Button>
          )}
          {(step === 'final' || step === 'deleting') && (
            <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={busy || !nameMatches}>
              {busy ? 'กำลังลบ...' : 'ลบห้องเรียนถาวร'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CountSection({ tone, title, rows, empty }: { tone: 'danger' | 'safe'; title: string; rows: CountRow[]; empty?: string }) {
  return (
    <div className={cn('space-y-1.5 rounded-lg border p-3', tone === 'danger' ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5')}>
      <p className={cn('flex items-center gap-1.5 text-sm font-semibold', tone === 'danger' ? 'text-destructive' : 'text-success')}>
        {tone === 'danger' ? <Trash2 className="size-4" /> : <ShieldCheck className="size-4" />}
        {title}
      </p>
      {rows.length === 0 && empty ? <p className="text-sm text-muted-foreground">{empty}</p> : <CountList rows={rows} />}
    </div>
  )
}

function CountList({ rows }: { rows: CountRow[] }) {
  return (
    <dl className="space-y-0.5 text-sm">
      {rows.map((row) => (
        <div key={row.key} className={cn('flex items-baseline justify-between gap-3', row.nested && 'pl-4 text-muted-foreground')}>
          <dt className="min-w-0">{row.label}</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-foreground">{nf.format(row.value)}</dd>
        </div>
      ))}
    </dl>
  )
}
