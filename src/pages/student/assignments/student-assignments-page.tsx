import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AssignmentResourcesDisclosure } from '@/features/student-portal/assignment-resources-disclosure'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getResourceCounts } from '@/services/assignment-resource-service'
import { filterMyAssignments, getMyAssignments, type AssignmentFilter } from '@/services/student-portal-service'
import type { MyAssignment } from '@/types/student-portal'

const FILTERS: { key: AssignmentFilter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'not_submitted', label: 'ยังไม่ส่ง' },
  { key: 'submitted', label: 'ส่งแล้ว' },
  { key: 'late', label: 'ส่งช้า' },
  { key: 'missing', label: 'ขาดส่ง' },
]

const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

const SUBMISSION_STATUS_BADGE_VARIANT: Record<string, 'success' | 'outline' | 'warning' | 'destructive'> = {
  not_submitted: 'outline',
  submitted: 'success',
  late: 'warning',
  missing: 'destructive',
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'ไม่มีกำหนดส่ง'
  return new Date(dueDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * /student/assignments — read-only across every subject+classroom the
 * student belongs to. Filters are a pure client-side split
 * (filterMyAssignments) over the same already-fetched, RLS-scoped list;
 * no separate query per filter. Student file upload/submission is not
 * implemented here on purpose — see the task scope this page was built
 * against.
 */
export function StudentAssignmentsPage() {
  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<AssignmentFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getMyAssignments()
      .then(async (rows) => {
        if (!active) return
        setAssignments(rows)
        // One batched count query for every visible assignment — never a
        // per-row resource fetch just to decide whether to show the
        // "ใบงานและลิงก์" toggle (see AssignmentResourcesDisclosure).
        const counts = await getResourceCounts(rows.map((a) => a.id)).catch(() => ({}))
        if (active) setResourceCounts(counts)
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

  const filtered = filterMyAssignments(assignments, filter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">งานของฉัน</h1>
        <p className="mt-1 text-sm text-muted-foreground">งานทั้งหมดจากทุกรายวิชาของฉัน</p>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              filter === f.key
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">ไม่มีงานในหมวดนี้</p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((a) => (
                <div key={a.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.subjectName} · {a.classroomName} · กำหนดส่ง {formatDueDate(a.dueDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {a.score !== null ? `${a.score}/${a.maxScore}` : `-/${a.maxScore}`}
                      </span>
                      <Badge variant={SUBMISSION_STATUS_BADGE_VARIANT[a.status] ?? 'outline'}>
                        {SUBMISSION_STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </div>
                  </div>
                  <AssignmentResourcesDisclosure assignmentId={a.id} resourceCount={resourceCounts[a.id] ?? 0} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
