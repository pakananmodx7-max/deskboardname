import { AlertTriangle, CalendarCheck, ClipboardX, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AiAssistantCard } from '@/components/dashboard/ai-assistant-card'
import { AssignmentOverview } from '@/components/dashboard/assignment-overview'
import { AttendanceOverview } from '@/components/dashboard/attendance-overview'
import { AttentionStudents } from '@/components/dashboard/attention-students'
import { IntegrationStatus } from '@/components/dashboard/integration-status'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { StatCard } from '@/components/dashboard/stat-card'
import { getDashboardData, getIntegrationStatus } from '@/services/dashboard-service'
import type { DashboardData, IntegrationStatusItem } from '@/types/dashboard'

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationStatusItem[]>([])

  useEffect(() => {
    let active = true

    getDashboardData().then((result) => {
      if (active) setData(result)
    })
    getIntegrationStatus().then((result) => {
      if (active) setIntegrations(result)
    })

    return () => {
      active = false
    }
  }, [])

  if (!data) {
    return <div className="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</div>
  }

  const { stats, attendance, atRiskStudents, assignments, recentActivity } = data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">ภาพรวมห้องเรียน</h1>
        <p className="mt-1 text-sm text-muted-foreground">ม.5/1 · ภาคเรียนที่ 1 / 2569</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="นักเรียนทั้งหมด"
          value={`${stats.totalStudents} คน`}
          icon={Users}
        />
        <StatCard
          label="มาเรียนวันนี้"
          value={`${stats.presentToday} / ${stats.totalStudents}`}
          helperText={`${stats.attendanceRate}%`}
          icon={CalendarCheck}
          tone="success"
        />
        <StatCard
          label="งานที่ยังไม่ส่ง"
          value={`${stats.missingAssignments} รายการ`}
          icon={ClipboardX}
          tone="warning"
        />
        <StatCard
          label="นักเรียนที่ควรติดตาม"
          value={`${stats.studentsAtRisk} คน`}
          icon={AlertTriangle}
          tone="destructive"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <AiAssistantCard />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttendanceOverview attendance={attendance} />
            <AssignmentOverview assignments={assignments} />
          </div>
          <QuickActions />
          <RecentActivity activity={recentActivity} />
        </div>

        <div className="space-y-4">
          <AttentionStudents students={atRiskStudents} />
          <IntegrationStatus items={integrations} />
        </div>
      </div>
    </div>
  )
}
