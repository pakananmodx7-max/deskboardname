import { AlertTriangle, Download, Loader2, Printer, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import type { StudentQrCode } from '@/services/qr-submission-service'
import type { ClassroomStudent } from '@/types/student'

import type { QrCard } from './qr-print-model'
import { downloadQrPng, printQrCards, qrDataUrl } from './qr-render'

interface StudentQrDialogProps {
  student: ClassroomStudent | null
  classroomName: string
  /** Loads (or returns the cached) classroom QR codes. */
  loadCode: (studentId: string) => Promise<StudentQrCode | null>
  regenerate: (studentId: string) => Promise<StudentQrCode>
  onClose: () => void
}

/** QR preview for one student: download as PNG, print, or replace a lost
 * card (the old QR stops working at once). */
export function StudentQrDialog({ student, classroomName, loadCode, regenerate, onClose }: StudentQrDialogProps) {
  const { toast } = useToast()
  const [result, setResult] = useState<{ studentId: string; image: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState<'download' | 'print' | 'regenerate' | null>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const studentId = student?.id ?? null
  const current = result && result.studentId === studentId ? result : null

  useEffect(() => {
    if (!studentId) return
    let active = true
    loadCode(studentId)
      .then(async (code) => {
        if (!active) return
        if (!code) {
          setResult({ studentId, image: null, error: 'ไม่พบ QR ของนักเรียนคนนี้' })
          return
        }
        const image = await qrDataUrl(code.token)
        if (active) setResult({ studentId, image, error: null })
      })
      .catch((err: unknown) => active && setResult({ studentId, image: null, error: toFriendlyErrorMessage(err, 'โหลด QR ไม่สำเร็จ') }))
    return () => {
      active = false
    }
  }, [studentId, loadCode])

  const name = student ? `${student.firstName} ${student.lastName}` : ''
  const card = (image: string): QrCard => ({ studentName: name, classroomName, number: student?.number ?? null, studentCode: student?.studentCode ?? null, qrDataUrl: image })

  async function run(kind: 'download' | 'print') {
    if (!current?.image) return
    setBusy(kind)
    try {
      if (kind === 'download') await downloadQrPng(card(current.image))
      else await printQrCards([card(current.image)], 'single', `QR ${name}`)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, kind === 'download' ? 'ดาวน์โหลดไม่สำเร็จ' : 'พิมพ์ไม่สำเร็จ'))
    } finally {
      setBusy(null)
    }
  }

  async function handleRegenerate() {
    if (!studentId) return
    setBusy('regenerate')
    try {
      const fresh = await regenerate(studentId)
      setResult({ studentId, image: await qrDataUrl(fresh.token), error: null })
      toast(`สร้าง QR ใหม่ให้ ${name} แล้ว — QR เดิมใช้ไม่ได้อีกต่อไป`)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'สร้าง QR ใหม่ไม่สำเร็จ'))
    } finally {
      setBusy(null)
      setConfirmRegenerate(false)
    }
  }

  return (
    <>
      <Dialog open={student !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR ประจำตัวนักเรียน</DialogTitle>
            <DialogDescription>ใช้ QR เดิมได้ทุกงานและทุกภาคเรียน</DialogDescription>
          </DialogHeader>

          {student && (
            <div className="flex flex-col items-center gap-3 text-center">
              {/* Always black-on-white, also in dark mode, so it scans. */}
              <div className="flex size-60 items-center justify-center rounded-2xl border border-border bg-white p-3 shadow-sm" data-testid="student-qr-image">
                {current?.image ? (
                  <img src={current.image} alt={`QR ของ ${name}`} className="size-full [image-rendering:pixelated]" />
                ) : current?.error ? (
                  <p role="alert" className="flex flex-col items-center gap-2 px-3 text-sm text-destructive">
                    <AlertTriangle className="size-5" />
                    {current.error}
                  </p>
                ) : (
                  <Loader2 className="size-7 animate-spin text-slate-400" aria-label="กำลังโหลด QR" />
                )}
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{name}</p>
                <p className="text-sm text-muted-foreground">
                  {classroomName} · เลขที่ {student.number ?? '-'}
                  {student.studentCode ? ` · รหัส ${student.studentCode}` : ''}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => run('print')} disabled={!current?.image || busy !== null}>
                {busy === 'print' ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                พิมพ์
              </Button>
              <Button type="button" onClick={() => run('download')} disabled={!current?.image || busy !== null}>
                {busy === 'download' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                ดาวน์โหลด PNG
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRegenerate(true)} disabled={!current?.image || busy !== null} className="justify-self-center text-muted-foreground">
              <RefreshCw className="size-4" />
              บัตรหาย? สร้าง QR ใหม่
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={(open) => !open && busy !== 'regenerate' && setConfirmRegenerate(false)}
        title="สร้าง QR ใหม่?"
        description={`QR เดิมของ ${name} จะใช้สแกนไม่ได้ทันที (เช่น เมื่อบัตรหาย) — ต้องพิมพ์บัตรใบใหม่ให้นักเรียน ข้อมูลการส่งงานเดิมยังอยู่ครบ`}
        confirmLabel="สร้าง QR ใหม่"
        destructive
        onConfirm={handleRegenerate}
      />
    </>
  )
}
