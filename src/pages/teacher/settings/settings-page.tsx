import { AlertCircle, Download, Loader2, Settings } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { downloadBlob, buildZip } from '@/lib/export/zip-export'
import { buildTeacherBackup } from '@/services/backup-service'

type ExportState = 'idle' | 'exporting' | 'error'

function backupFilename(generatedAt: string): string {
  // Sortable, filesystem-safe timestamp — e.g. classroom-backup-2026-09-10-1420.zip
  const stamp = generatedAt.replace(/[:]/g, '').slice(0, 15).replace('T', '-')
  return `classroom-backup-${stamp}.zip`
}

export function SettingsPage() {
  const { toast } = useToast()
  const [state, setState] = useState<ExportState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleExport() {
    setState('exporting')
    setErrorMessage(null)
    try {
      const backup = await buildTeacherBackup()
      const zip = await buildZip(backup.files)
      downloadBlob(zip, backupFilename(backup.generatedAt))
      setState('idle')
      toast('ดาวน์โหลดไฟล์สำรองข้อมูลสำเร็จ')
    } catch (err) {
      setState('error')
      setErrorMessage(err instanceof Error ? err.message : 'ไม่สามารถสร้างไฟล์สำรองข้อมูลได้ กรุณาลองใหม่อีกครั้ง')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">ตั้งค่า</h1>
          <p className="text-sm text-muted-foreground">การตั้งค่าบัญชี ห้องเรียน และระบบ</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>สำรองข้อมูล</CardTitle>
          <CardDescription>
            ดาวน์โหลดข้อมูลวิชาการของคุณทั้งหมด (ห้องเรียน นักเรียน รายวิชา งาน คะแนน การเช็คชื่อ บทเรียน) เป็นไฟล์ ZIP
            ที่มี CSV แยกตามประเภทข้อมูล สำหรับเก็บไว้เป็นสำเนาสำรองส่วนตัว
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ไฟล์สำรองนี้มีเฉพาะข้อมูลของคุณเท่านั้น และมีเฉพาะข้อมูล — ไม่รวมไฟล์แนบ (เช่น ไฟล์งานที่อัปโหลด) โดยตรง
            มีเพียงชื่อไฟล์และตำแหน่งจัดเก็บเท่านั้น
          </p>

          {state === 'error' && errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <Button onClick={handleExport} disabled={state === 'exporting'}>
            {state === 'exporting' ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังสร้างไฟล์สำรองข้อมูล...
              </>
            ) : (
              <>
                <Download className="size-4" />
                ดาวน์โหลดไฟล์สำรองข้อมูล
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
