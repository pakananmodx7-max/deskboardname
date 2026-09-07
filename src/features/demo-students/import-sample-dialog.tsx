import { FileSpreadsheet, Upload } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { SAMPLE_IMPORT_ROWS } from '@/demo/students'
import { useDemoClassroom } from '@/demo/demo-context'

interface ImportSampleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportSampleDialog({ open, onOpenChange }: ImportSampleDialogProps) {
  const { importStudents } = useDemoClassroom()
  const { toast } = useToast()
  const [showPreview, setShowPreview] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) setShowPreview(false)
    onOpenChange(next)
  }

  function handleConfirm() {
    const count = importStudents(SAMPLE_IMPORT_ROWS)
    toast(`นำเข้านักเรียนสำเร็จ ${count} คน`)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Students</DialogTitle>
          <DialogDescription>
            เดโมนี้จำลองการนำเข้าไฟล์ .xlsx / .csv ด้วยข้อมูลตัวอย่าง (ไม่มีการอัปโหลดไฟล์จริง)
          </DialogDescription>
        </DialogHeader>

        {!showPreview ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center">
            <Upload className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">ลากไฟล์มาวาง หรือเลือกไฟล์ (ปิดใช้งานในเดโม)</p>
            <Button type="button" onClick={() => setShowPreview(true)}>
              <FileSpreadsheet className="size-4" />
              ใช้ข้อมูลตัวอย่าง
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              พบทั้งหมด: {SAMPLE_IMPORT_ROWS.length} คน — <span className="text-success">พร้อมนำเข้าทั้งหมด</span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">รหัสนักเรียน</th>
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="px-3 py-2 font-medium">นามสกุล</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_IMPORT_ROWS.map((row) => (
                    <tr key={row.studentCode} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <Badge variant="success">Ready</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.studentCode}</td>
                      <td className="px-3 py-2">{row.firstName}</td>
                      <td className="px-3 py-2">{row.lastName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showPreview && (
          <DialogFooter>
            <Button onClick={handleConfirm}>ยืนยันนำเข้า ({SAMPLE_IMPORT_ROWS.length})</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
