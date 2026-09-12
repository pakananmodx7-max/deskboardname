import { FileText, ListChecks, School } from 'lucide-react'
import { useEffect, useState } from 'react'

import { HermesSummaryCard } from '@/features/home/hermes-summary-card'
import { ModuleSummaryCard } from '@/features/home/module-summary-card'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getDashboardFollowUpSummary,
  getDashboardOverview,
  type DashboardOverview,
} from '@/services/dashboard-service'

/**
 * /teacher/dashboard — the NEW global "หน้าหลัก" (Requirement 6: a
 * personal command center, not a classroom-specific one). This is a
 * DIFFERENT page from the old /teacher/dashboard content, which moved,
 * unchanged, to /teacher/classroom-management (see
 * classroom-overview-page.tsx) and is now "ระบบจัดการชั้นเรียน → ภาพรวม".
 *
 * Every number shown here is fetched from the SAME existing services the
 * classroom overview page already uses (getDashboardOverview,
 * getDashboardFollowUpSummary) — nothing is hardcoded, and nothing here
 * re-implements those queries.
 */
export function HomePageReal() {
  const { profile } = useAuth()

  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [followUpCount, setFollowUpCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    getDashboardOverview()
      .then((result) => {
        if (active) setOverview(result)
      })
      .catch((err: unknown) => {
        if (active) setOverviewError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setOverviewLoading(false)
      })

    getDashboardFollowUpSummary()
      .then((rows) => {
        if (active) setFollowUpCount(rows.length)
      })
      .catch(() => {
        // Follow-up count is a secondary "footer" detail on the module
        // card — a failure here shouldn't block the rest of the Home
        // page, so it's silently left as null (card just omits it).
      })

    return () => {
      active = false
    }
  }, [])

  const greetingName = profile?.displayName || profile?.email || 'ครู'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">สวัสดี, {greetingName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">นี่คือภาพรวมของทุกระบบที่คุณใช้งานอยู่</p>
      </div>

      {overviewError && <p className="text-sm text-destructive">{overviewError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModuleSummaryCard
          icon={School}
          title="ระบบจัดการชั้นเรียน"
          subtitle="Classroom Management System"
          to="/teacher/classroom-management"
          stats={[
            { label: 'ห้องเรียน', value: overviewLoading ? '-' : `${overview?.activeClassroomCount ?? 0}` },
            { label: 'นักเรียน', value: overviewLoading ? '-' : `${overview?.studentCount ?? 0}` },
            { label: 'รายวิชา', value: overviewLoading ? '-' : `${overview?.subjectCount ?? 0}` },
          ]}
          description={
            followUpCount !== null && followUpCount > 0 ? `มีนักเรียน ${followUpCount} คนที่ควรติดตาม` : undefined
          }
        />
        <ModuleSummaryCard
          icon={FileText}
          title="ระบบเอกสาร"
          to="/teacher/documents"
          badge="เร็ว ๆ นี้"
          description="จัดการเอกสารและแบบฟอร์มต่าง ๆ ของคุณในที่เดียว"
        />
        <ModuleSummaryCard
          icon={ListChecks}
          title="งานและเตือนความจำ"
          to="/teacher/tasks"
          badge="เร็ว ๆ นี้"
          description="รายการสิ่งที่ต้องทำและการเตือนความจำส่วนตัว"
        />
      </div>

      <HermesSummaryCard />
    </div>
  )
}
