import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildSubjectClassroomTabPath } from '@/features/subjects-shared/subject-classroom-nav'
import type { TodayAttendanceStatus } from '@/services/dashboard-service'

interface TodayAttendanceCardProps {
  loading: boolean
  error: string | null
  items: TodayAttendanceStatus[]
}

/**
 * Section 3 — "การเช็คชื่อวันนี้". Every action here deep-links straight
 * into the real subject's เช็คชื่อ tab (buildSubjectClassroomTabPath) —
 * this card never edits attendance itself, per "Do not recreate
 * attendance editing on Dashboard."
 */
export function TodayAttendanceCard({ loading, error, items }: TodayAttendanceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">การเช็คชื่อวันนี้</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">
            ยังไม่มีวิชาที่เชื่อมกับห้องเรียน — ไปที่ Subjects เพื่อเชื่อมห้องเรียนก่อน
          </p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div
                key={`${item.subjectId}:${item.classroomId}`}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {item.subjectName} · {item.classroomName}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={item.status === 'taken' ? 'success' : 'warning'}>
                      {item.status === 'taken' ? 'บันทึกแล้ว' : 'ยังไม่ได้เช็ค'}
                    </Badge>
                    {item.status === 'taken' && (
                      <span className="text-xs text-muted-foreground">{item.recordCount} คน</span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link to={buildSubjectClassroomTabPath(item.subjectId, item.classroomId, 'attendance')}>
                    {item.status === 'taken' ? 'ดู/แก้ไข' : 'เช็คชื่อ'}
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
