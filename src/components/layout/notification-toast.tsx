import { MessageSquare, X } from 'lucide-react'
import { useEffect } from 'react'

import type { MyNotification } from '@/types/student-portal'

interface NotificationToastProps {
  notification: MyNotification | null
  onDismiss: () => void
  onView: () => void
}

const AUTO_DISMISS_MS = 6000

/**
 * Top-right live toast for a newly-arrived teacher notification — purely
 * an enhancement layered on top of useStudentNotifications' Realtime
 * subscription (see that hook's doc comment): this component never reads
 * or writes the database itself, it only ever renders whatever
 * notification the hook just announced. Deliberately a separate,
 * dedicated component rather than reusing the app-wide bottom/bottom-
 * right ToastProvider (src/components/ui/toast.tsx) — that system is
 * shared by the whole app (including teacher pages) and fixed to
 * bottom-center/right, whereas this is specifically a top-right,
 * student-portal-only surface for exactly one thing: "a message from a
 * teacher just arrived while I have this open."
 */
export function NotificationToast({ notification, onDismiss, onView }: NotificationToastProps) {
  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [notification, onDismiss])

  if (!notification) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex justify-end">
      <div className="pointer-events-auto flex w-[min(22rem,90vw)] items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
        <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">ข้อความใหม่จากครู</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{notification.message}</p>
          <button type="button" onClick={onView} className="mt-1.5 text-xs font-medium text-primary hover:underline">
            ดู
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="ปิด"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
