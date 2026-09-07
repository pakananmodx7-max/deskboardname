import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ActivityItem } from '@/types/dashboard'

interface RecentActivityProps {
  activity: ActivityItem[]
}

export function RecentActivity({ activity }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">กิจกรรมล่าสุด</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {activity.map((item) => (
            <li key={item.id} className="flex gap-3 text-sm">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{item.timeLabel}</span>
              <span className="text-foreground">{item.message}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
