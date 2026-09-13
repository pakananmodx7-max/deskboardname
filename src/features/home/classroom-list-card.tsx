import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/dashboard/empty-state'
import { DashboardSection } from '@/components/dashboard/dashboard-section'
import type { ClassroomListItem } from '@/services/dashboard-service'

interface ClassroomListCardProps {
  loading: boolean
  error: string | null
  items: ClassroomListItem[]
}

/**
 * The Home page's "ห้องเรียนของฉัน" section — every active classroom this
 * teacher owns, its linked subjects and current roster size (see
 * dashboard-service.ts's getClassroomListItems), each row linking straight
 * into that classroom's workspace. No status text is invented beyond the
 * student count itself.
 */
export function ClassroomListCard({ loading, error, items }: ClassroomListCardProps) {
  return (
    <DashboardSection title="ห้องเรียนของฉัน" bodyClassName="p-0">
      {loading ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : error ? (
        <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState message="ยังไม่มีห้องเรียน" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.classroomId}>
              <Link
                to={`/teacher/classrooms/${item.classroomId}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{item.classroomName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {item.subjectNames.map((name) => (
                      <Badge key={name} variant="secondary">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{item.studentCount} คน</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  )
}
