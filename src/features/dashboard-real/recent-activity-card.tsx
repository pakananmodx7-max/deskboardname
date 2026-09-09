import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RecentActivityItem } from '@/services/dashboard-service'

interface RecentActivityCardProps {
  loading: boolean
  error: string | null
  items: RecentActivityItem[]
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
  const days = Math.floor(hours / 24)
  return `${days} วันที่แล้ว`
}

/**
 * Section 8 — only ever built from real, timestamp-backed events
 * (assignment created/updated, attendance session saved) — see
 * dashboard-service.ts's getRecentActivity/buildRecentActivityItems.
 * Never a fabricated feed.
 */
export function RecentActivityCard({ loading, error, items }: RecentActivityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">กิจกรรมล่าสุด</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีกิจกรรมล่าสุด</p>
        ) : (
          <ol className="space-y-3 px-5 py-4">
            {items.map((item) => (
              <li key={item.id} className="flex gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{formatRelativeTime(item.timestamp)}</span>
                <span className="text-foreground">{item.message}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
