import {
  AlertTriangle,
  Bell,
  BellOff,
  BookOpenCheck,
  CalendarClock,
  Check,
  CheckCheck,
  ClipboardList,
  FileCheck2,
  FilePen,
  Loader2,
  MessageSquare,
  RotateCw,
  UserCheck,
  UserPlus,
  UserX,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  describeNotification,
  filterNotifications,
  formatRelativeTime,
  formatUnreadBadge,
  type AppNotification,
  type FeedConnection,
  type FeedStatus,
  type NotificationFilter,
  type NotificationIcon,
} from './notification-model'
import { TONE_STYLE } from './notification-styles'

const ICONS: Record<NotificationIcon, LucideIcon> = {
  submission: FileCheck2,
  resubmission: FilePen,
  request: UserPlus,
  approved: UserCheck,
  rejected: UserX,
  assignment: ClipboardList,
  graded: BookOpenCheck,
  deadline: CalendarClock,
  message: MessageSquare,
}

export interface NotificationPopoverProps {
  status: FeedStatus
  error: string | null
  items: AppNotification[]
  unreadCount: number
  hasMore: boolean
  loadingMore: boolean
  connection: FeedConnection
  /** Text for the "not set up yet" state (0029 not applied). */
  unavailableText?: string
  emptyText?: string
  onRetry: () => void
  onLoadMore: () => void
  /** Mark read + navigate (the caller closes nothing — the popover does). */
  onOpen: (notification: AppNotification) => void
  onMarkRead: (notification: AppNotification) => void
  onMarkAllRead: () => void
  /** Tests / previews. */
  defaultOpen?: boolean
  now?: Date
}

/**
 * The header bell (same button, same place as before) with its popover:
 * unread badge (99+ cap), ทั้งหมด / ยังไม่อ่าน filters, relative times,
 * per-item and "อ่านทั้งหมด" actions, load more, and loading / empty /
 * error / not-set-up states. Purely presentational — data comes from
 * useNotificationFeed (or the student merge of it).
 */
export function NotificationPopover({
  status,
  error,
  items,
  unreadCount,
  hasMore,
  loadingMore,
  connection,
  unavailableText = 'ระบบแจ้งเตือนยังไม่พร้อมใช้งาน',
  emptyText = 'ยังไม่มีการแจ้งเตือน',
  onRetry,
  onLoadMore,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  defaultOpen = false,
  now,
}: NotificationPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const badge = formatUnreadBadge(unreadCount)
  const visible = filterNotifications(items, filter)
  const clock = now ?? new Date()

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={badge ? `การแจ้งเตือน (ยังไม่อ่าน ${badge} รายการ)` : 'การแจ้งเตือน'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        <Bell className="size-5" />
        {badge && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground ring-2 ring-card"
            data-testid="notification-badge"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="การแจ้งเตือน"
          className="fixed inset-x-2 top-16 z-40 flex max-h-[min(36rem,calc(100vh-5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 pb-2 pt-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">การแจ้งเตือน</h2>
              {badge && <span className="rounded-full bg-destructive/12 px-2 py-0.5 text-[11px] font-semibold text-destructive">{badge} ใหม่</span>}
            </div>
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0 || status !== 'ready'}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" />
              อ่านทั้งหมด
            </button>
          </div>

          <div className="flex items-center gap-1 border-b border-border px-3 py-2" role="tablist" aria-label="ตัวกรองการแจ้งเตือน">
            {(['all', 'unread'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  filter === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {key === 'all' ? 'ทั้งหมด' : `ยังไม่อ่าน${unreadCount > 0 ? ` (${formatUnreadBadge(unreadCount)})` : ''}`}
              </button>
            ))}
            {connection === 'offline' && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="กำลังเชื่อมต่อใหม่ — ระบบจะดึงรายการที่พลาดไปให้อัตโนมัติ">
                <WifiOff className="size-3.5" />
                ออฟไลน์
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            {status === 'loading' ? (
              <ul className="space-y-1 p-3" aria-label="กำลังโหลดการแจ้งเตือน" data-testid="notification-loading">
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="flex gap-3 rounded-xl p-2">
                    <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
                    <span className="flex-1 space-y-2 py-1">
                      <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                      <span className="block h-3 w-full animate-pulse rounded bg-muted" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : status === 'error' ? (
              <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <AlertTriangle className="size-6 text-destructive" />
                <p className="text-sm text-foreground">{error ?? 'โหลดการแจ้งเตือนไม่สำเร็จ'}</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <RotateCw className="size-4" />
                  ลองใหม่
                </button>
              </div>
            ) : status === 'unavailable' ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="notification-unavailable">
                <BellOff className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{unavailableText}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="notification-empty">
                <Bell className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{filter === 'unread' ? 'ไม่มีการแจ้งเตือนที่ยังไม่อ่าน' : emptyText}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {visible.map((n) => (
                  <NotificationRowItem
                    key={`${n.origin}:${n.id}`}
                    notification={n}
                    now={clock}
                    onOpen={() => {
                      setOpen(false)
                      onOpen(n)
                    }}
                    onMarkRead={() => onMarkRead(n)}
                  />
                ))}
              </ul>
            )}
            {status === 'ready' && error && items.length > 0 && (
              <p role="alert" className="px-4 py-2 text-center text-xs text-destructive">
                {error}
              </p>
            )}
            {status === 'ready' && hasMore && (
              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
                >
                  {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                  {loadingMore ? 'กำลังโหลด...' : 'โหลดการแจ้งเตือนก่อนหน้า'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NotificationRowItem({ notification, now, onOpen, onMarkRead }: { notification: AppNotification; now: Date; onOpen: () => void; onMarkRead: () => void }) {
  const view = describeNotification(notification)
  const Icon = ICONS[view.icon]
  const unread = notification.readAt === null
  return (
    <li className={cn('group relative flex items-start gap-1 pr-2 transition-colors hover:bg-accent/60', unread && 'bg-primary/[0.04]')}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
        <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', TONE_STYLE[view.tone].icon)} aria-hidden="true">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className={cn('min-w-0 flex-1 text-sm leading-snug', unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/85')}>{view.title}</span>
            {view.status && (
              <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold', TONE_STYLE[view.status.tone].badge)}>{view.status.label}</span>
            )}
          </span>
          {view.description && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-foreground/80">{view.description}</span>}
          {view.details.length > 0 && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{view.details.join(' · ')}</span>}
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {unread && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
            <time dateTime={notification.createdAt}>{formatRelativeTime(notification.createdAt, now)}</time>
            {unread && <span className="sr-only">ยังไม่อ่าน</span>}
          </span>
        </span>
      </button>
      {unread && (
        <button
          type="button"
          onClick={onMarkRead}
          className="mt-3 rounded-md p-1.5 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="ทำเครื่องหมายว่าอ่านแล้ว"
          title="ทำเครื่องหมายว่าอ่านแล้ว"
        >
          <Check className="size-4" />
        </button>
      )}
    </li>
  )
}
