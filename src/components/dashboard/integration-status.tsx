import { Circle } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { IntegrationConnectionState, IntegrationStatusItem } from '@/types/dashboard'

interface IntegrationStatusProps {
  items: IntegrationStatusItem[]
}

const stateLabel: Record<IntegrationConnectionState, string> = {
  not_configured: 'Not configured',
  not_connected: 'Not connected',
  connected: 'Connected',
}

const stateColor: Record<IntegrationConnectionState, string> = {
  not_configured: 'text-muted-foreground fill-muted-foreground',
  not_connected: 'text-muted-foreground fill-muted-foreground',
  connected: 'text-success fill-success',
}

export function IntegrationStatus({ items }: IntegrationStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">สถานะการเชื่อมต่อระบบ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between text-sm">
            <span>{item.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Circle className={`size-2 ${stateColor[item.state]}`} />
              {stateLabel[item.state]}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
