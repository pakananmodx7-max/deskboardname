import { mapNotificationRow, NOTIFICATION_PAGE_SIZE, type AppNotification, type NotificationRow } from '@/features/notifications/notification-model'
import { getSupabaseClient } from '@/lib/supabase'
import { isOptionalTableMissingError } from '@/services/student-portal-service'

/**
 * public.notifications (0029_notifications.sql). Every query is scoped by
 * RLS to the signed-in user's own rows (recipient_user_id = auth.uid());
 * the explicit recipient filter only lets Postgres use the index. Rows are
 * never written from here — they are created by server-side triggers —
 * and read state changes only through the two own-rows RPCs.
 */

const COLUMNS = 'id, notification_type, title, body, entity_type, entity_id, metadata, read_at, created_at'

/** 0029 not applied yet (table or RPC missing). */
export class NotificationsUnavailableError extends Error {
  constructor() {
    super('ระบบแจ้งเตือนยังไม่พร้อมใช้งาน')
    this.name = 'NotificationsUnavailableError'
  }
}

const MISSING_FUNCTION_CODES = new Set(['42883', 'PGRST202'])

function isMissingFunctionError(error: unknown): boolean {
  return MISSING_FUNCTION_CODES.has((error as { code?: string } | null)?.code ?? '')
}

function rethrow(error: unknown): never {
  if (isOptionalTableMissingError(error) || isMissingFunctionError(error)) throw new NotificationsUnavailableError()
  throw error
}

export interface NotificationCursor {
  createdAt: string
  id: string
}

export interface NotificationPage {
  items: AppNotification[]
  hasMore: boolean
}

function rowsToPage(rows: NotificationRow[], limit: number): NotificationPage {
  const items = rows
    .slice(0, limit)
    .map(mapNotificationRow)
    .filter((n): n is AppNotification => n !== null)
  return { items, hasMore: rows.length > limit }
}

/** One page, newest first. Keyset pagination on (created_at, id) so a
 * notification arriving while paging never shifts or repeats a page. */
export async function listMyNotifications(userId: string, cursor: NotificationCursor | null = null, limit = NOTIFICATION_PAGE_SIZE): Promise<NotificationPage> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('notifications')
    .select(COLUMNS)
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) rethrow(error)
  return rowsToPage((data ?? []) as NotificationRow[], limit)
}

export async function countMyUnreadNotifications(userId: string): Promise<number> {
  const supabase = getSupabaseClient()
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', userId)
    .is('read_at', null)
  if (error) rethrow(error)
  return count ?? 0
}

export async function markMyNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await getSupabaseClient().rpc('mark_my_notifications_read', { p_ids: ids })
  if (error) rethrow(error)
}

export async function markAllMyNotificationsRead(): Promise<void> {
  const { error } = await getSupabaseClient().rpc('mark_all_my_notifications_read')
  if (error) rethrow(error)
}

/** Creates "due today / tomorrow" reminders for the caller (idempotent,
 * server-side). Missing RPC (0029 not applied) is silently ignored. */
export async function refreshMyDeadlineNotifications(): Promise<void> {
  const { error } = await getSupabaseClient().rpc('refresh_my_deadline_notifications')
  if (error && !isMissingFunctionError(error)) throw error
}

export type RealtimeStatus = 'connecting' | 'live' | 'offline'

/** Maps supabase-js channel states to the bell's connection state. */
export function toRealtimeStatus(status: string): RealtimeStatus {
  if (status === 'SUBSCRIBED') return 'live'
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') return 'offline'
  return 'connecting'
}

/**
 * Live INSERT/UPDATE events for the user's own rows (Realtime applies the
 * same SELECT policy). supabase-js re-joins the channel by itself after a
 * network drop; every transition is reported through `onStatus` so the
 * caller can resync missed rows. Returns the cleanup function.
 */
export function subscribeToMyNotifications(
  userId: string,
  handlers: { onChange: (notification: AppNotification) => void; onStatus: (status: RealtimeStatus) => void },
): () => void {
  const supabase = getSupabaseClient()
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as NotificationRow | undefined
        if (!row || !row.id) return
        const notification = mapNotificationRow(row)
        if (notification) handlers.onChange(notification)
      },
    )
    .subscribe((status) => handlers.onStatus(toRealtimeStatus(status)))
  return () => {
    void supabase.removeChannel(channel)
  }
}
