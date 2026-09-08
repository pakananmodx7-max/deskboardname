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

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  /** Destructive styling reserved for permanent, irreversible actions
   * (see Students page spec: "Use destructive styling only for permanent
   * delete") — a reversible action like removing classroom membership or
   * archiving should NOT use this. */
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}

/** Generic confirm-before-acting dialog, reused by every destructive or
 * hard-to-undo student action (remove from classroom, move classroom,
 * delete/archive) instead of each building its own. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'กำลังดำเนินการ...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
