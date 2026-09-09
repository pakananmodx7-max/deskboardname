import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { computeAttendanceRate, getMyAttendance, summarizeMyAttendance } from '@/services/student-portal-service'
import type { MyAttendanceRecord } from '@/types/student-portal'
import { CalendarCheck } from 'lucide-react'

const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  present: 'มา',
  late: 'สาย',
  leave: 'ลา',
  absent: 'ขาด',
}

const ATTENDANCE_STATUS_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  present: 'success',
  late: 'warning',
  leave: 'warning',
  absent: 'destructive',
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * /student/attendance — reads attendance_records via 0011's
 * attendance_records_select_own_student policy (own rows only). Handles
 * BOTH classroom-level homeroom sessions (subjectId/periodNumber null)
 * and subject-scoped sessions safely — see getMyAttendance's join
 * against attendance_sessions in student-portal-service.ts — showing
 * subject/period context only when it's actually set on that session.
 */
export function StudentAttendancePage() {
  const [records, setRecords] = useState<MyAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getMyAttendance()
      .then((rows) => {
        if (active) setRecords(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const summary = summarizeMyAttendance(records)
  const rate = computeAttendanceRate(summary)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">การเข้าเรียน</h1>
        <p className="mt-1 text-sm text-muted-foreground">ประวัติการเข้าเรียนของฉันทุกห้องเรียนและรายวิชา</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="มา" value={`${summary.present}`} icon={CalendarCheck} tone="success" />
        <StatCard label="สาย" value={`${summary.late}`} icon={CalendarCheck} tone="warning" />
        <StatCard label="ลา" value={`${summary.leave}`} icon={CalendarCheck} />
        <StatCard label="ขาด" value={`${summary.absent}`} icon={CalendarCheck} tone="destructive" />
        <StatCard label="เปอร์เซ็นต์การเข้าเรียน" value={rate !== null ? `${rate.toFixed(0)}%` : '-'} icon={CalendarCheck} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติการเข้าเรียน</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
          ) : records.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลการเข้าเรียน</p>
          ) : (
            <div className="divide-y divide-border">
              {records.map((record) => (
                <div key={record.sessionId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatDate(record.attendanceDate)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {record.classroomName}
                      {record.subjectName ? ` · ${record.subjectName}` : ' · เช็คชื่อประจำวัน'}
                      {record.periodNumber !== null ? ` · คาบ ${record.periodNumber}` : ''}
                    </p>
                  </div>
                  <Badge variant={ATTENDANCE_STATUS_BADGE_VARIANT[record.status] ?? 'outline'}>
                    {ATTENDANCE_STATUS_LABEL[record.status] ?? record.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
