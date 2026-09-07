import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AtRiskStudent, RiskLevel } from '@/types/dashboard'

interface AttentionStudentsProps {
  students: AtRiskStudent[]
}

const riskLabel: Record<RiskLevel, string> = {
  high: 'HIGH RISK',
  medium: 'MEDIUM RISK',
  low: 'LOW RISK',
}

const riskVariant: Record<RiskLevel, 'destructive' | 'warning' | 'secondary'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
}

function initials(name: string) {
  return name.trim().slice(0, 1)
}

export function AttentionStudents({ students }: AttentionStudentsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">นักเรียนที่ควรติดตาม</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {students.map((student) => (
          <div key={student.id} className="flex items-start gap-3">
            <Avatar>{initials(student.name)}</Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{student.name}</p>
                <Badge variant={riskVariant[student.riskLevel]}>{riskLabel[student.riskLevel]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {student.reasons.join(' · ')}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
