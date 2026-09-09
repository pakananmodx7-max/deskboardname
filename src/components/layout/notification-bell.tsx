import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { MyNotification } from '@/types/student-portal'

interface NotificationBellProps {
  notifications: MyNotification[]
  unreadCount: number
  loading: boolean
  error: string | null
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}

function formatNotificationTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Notification bell + compact dropdown panel — lives in StudentLayout so
 * it (and its unread badge) is present across every /student/* page.
 * Read-only from the student's point of view beyond "open"/"mark read"/
 * "mark all read" — there is no edit/delete affordance here at all,
 * matching teacher_student_notifications' RLS (no UPDATE policy exists
 * beyond the two narrow read-state RPCs, no DELETE policy at all).
 */
export function NotificationBell({
  notifications,
  unreadCount,
  loading,
  error,
  onMarkRead,
  onMarkAllRead,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label="การแจ้งเตือน"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,90vw)] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">ข้อความจากครู</span>
            {unreadCount > 0 && (
              <button type="button" onClick={onMarkAllRead} className="text-xs font-medium text-primary hover:underline">
                ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : error ? (
              <p className="px-4 py-6 text-center text-sm text-destructive">{error}</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อความจากครู</p>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onMarkRead(n.id)}
                    className={cn(
                      'block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-accent',
                      n.readAt === null && 'bg-primary/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{n.senderName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatNotificationTime(n.createdAt)}</span>
                    </div>
                    {n.title && <p className="mt-0.5 text-xs font-medium text-muted-foreground">{n.title}</p>}
                    <p className="mt-1 text-sm text-foreground">{n.message}</p>
                    {n.readAt === null && (
                      <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        ยังไม่ได้อ่าน
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
