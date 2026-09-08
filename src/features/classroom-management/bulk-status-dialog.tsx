import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import type { StudentStatus } from '@/types/student'

interface BulkStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  onConfirm: (status: StudentStatus) => void | Promise<void>
}

/** Bulk "เปลี่ยนสถานะ" — the one small piece not worth a whole ConfirmDialog
 * variant, since it needs a status picker rather than a yes/no. */
export function BulkStatusDialog({ open, onOpenChange, count, onConfirm }: BulkStatusDialogProps) {
  const [status, setStatus] = useState<StudentStatus>('active')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    try {
      await onConfirm(status)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>เปลี่ยนสถานะนักเรียน</DialogTitle>
          <DialogDescription>เปลี่ยนสถานะนักเรียนที่เลือก {count} คน</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="bulk-status">สถานะใหม่</Label>
          <NativeSelect
            id="bulk-status"
            className="w-full"
            value={status}
            onChange={(e) => setStatus(e.target.value as StudentStatus)}
          >
            <option value="active">กำลังเรียน</option>
            <option value="inactive">ไม่ได้ใช้งาน</option>
          </NativeSelect>
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'กำลังบันทึก...' : 'เปลี่ยนสถานะ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
