import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ATTENDANCE_STATUS_BUTTON_STYLE,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
  ATTENDANCE_SUMMARY_DOT_STYLE,
} from '@/features/attendance/attendance-status'
import { cn } from '@/lib/utils'
import { getAttendanceSummary } from '@/services/attendance-service'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { ClassroomStudent } from '@/types/student'

interface AttendanceRosterCardProps {
  roster: ClassroomStudent[]
  records: Record<string, AttendanceRecord>
  loading: boolean
  onSetStatus: (studentId: string, status: AttendanceStatus) => void
  onSetNote: (studentId: string, note: string) => void
}

/**
 * Shared summary-card + roster-table UI for every real, Supabase-backed
 * attendance surface in the app — the standalone classroom Attendance
 * page (attendance-page-real.tsx) and every subject's เช็คชื่อ tab
 * (subjects-real/tabs/attendance-tab.tsx) render through this exact same
 * component, per "reuse the existing real Attendance architecture and
 * UI — do not create a second unrelated attendance system." Each caller
 * owns its own data loading (they differ: classroom+date only, vs.
 * subject+classroom+date+period) and passes down the resolved roster and
 * records; this component owns only the summary tally and the
 * table/status-buttons/note rendering.
 */
export function AttendanceRosterCard({ roster, records, loading, onSetStatus, onSetNote }: AttendanceRosterCardProps) {
  const rosterRecords: Record<string, AttendanceRecord> = {}
  for (const student of roster) {
    if (records[student.id]) rosterRecords[student.id] = records[student.id]
  }
  const summary = getAttendanceSummary(rosterRecords)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">สรุปการเข้าเรียน</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {ATTENDANCE_STATUS_ORDER.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <span className={cn('size-2.5 rounded-full', ATTENDANCE_SUMMARY_DOT_STYLE[status])} />
              <span className="text-muted-foreground">{ATTENDANCE_STATUS_LABEL[status]}</span>
              <span className="font-semibold">{summary[status]}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
            <span className="text-muted-foreground">รวมทั้งหมด</span>
            <span className="font-semibold">{summary.total} คน</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">เลขที่</th>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 font-medium">สถานะ</th>
                  <th className="px-5 py-3 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : (
                  roster.map((student) => {
                    const current = records[student.id]?.status ?? 'present'
                    return (
                      <tr key={student.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                        <td className="px-5 py-3 font-medium">
                          {student.firstName} {student.lastName}
                          {student.nickname && (
                            <span className="ml-1.5 text-xs text-muted-foreground">({student.nickname})</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {ATTENDANCE_STATUS_ORDER.map((status) => (
                              <button
                                key={status}
                                type="button"
                                data-active={current === status}
                                onClick={() => onSetStatus(student.id, status)}
                                className={cn(
                                  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
                                  ATTENDANCE_STATUS_BUTTON_STYLE[status],
                                )}
                              >
                                {ATTENDANCE_STATUS_LABEL[status]}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <Input
                            value={records[student.id]?.note ?? ''}
                            onChange={(e) => onSetNote(student.id, e.target.value)}
                            placeholder="เช่น ป่วย, รถติด"
                            className="h-8 w-36 text-xs"
                            aria-label={`หมายเหตุของ ${student.firstName} ${student.lastName}`}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
