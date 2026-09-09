import { AlertTriangle, CalendarCheck, ClipboardX, Users } from 'lucide-react'

import { AiAssistantCard } from '@/components/dashboard/ai-assistant-card'
import { AssignmentOverview } from '@/components/dashboard/assignment-overview'
import { AttendanceOverview } from '@/components/dashboard/attendance-overview'
import { AttentionStudents } from '@/components/dashboard/attention-students'
import { IntegrationStatus } from '@/components/dashboard/integration-status'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { StatCard } from '@/components/dashboard/stat-card'
import { useDemoClassroom } from '@/demo/demo-context'
import { mockIntegrationStatus } from '@/data/integration-mock'

export function DashboardPageDemo() {
  const {
    classroomName,
    students,
    attendanceSummary,
    assignments,
    atRiskStudents,
    studentsWithMissingWork,
    activity,
  } = useDemoClassroom()

  const attendanceRate =
    attendanceSummary.total > 0 ? Math.round((attendanceSummary.present / attendanceSummary.total) * 100) : 0

  const assignmentSummaries = assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    dueDate: assignment.dueDate,
    submittedCount: Object.values(assignment.submissions).filter(Boolean).length,
    totalCount: students.length,
  }))

  const attentionList = atRiskStudents.slice(0, 5).map((item) => ({
    id: item.student.id,
    name: `${item.student.firstName} ${item.student.lastName}`,
    reasons: item.reasons,
    riskLevel: item.riskLevel,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">ภาพรวมห้องเรียน</h1>
        <p className="mt-1 text-sm text-muted-foreground">{classroomName} · ภาคเรียนที่ 1 / 2569</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="นักเรียนทั้งหมด" value={`${students.length} คน`} icon={Users} />
        <StatCard
          label="มาเรียนวันนี้"
          value={`${attendanceSummary.present} / ${attendanceSummary.total}`}
          helperText={`${attendanceRate}%`}
          icon={CalendarCheck}
          tone="success"
        />
        <StatCard
          label="นักเรียนที่มีงานค้าง"
          value={`${studentsWithMissingWork} คน`}
          icon={ClipboardX}
          tone="warning"
        />
        <StatCard
          label="นักเรียนที่ควรติดตาม"
          value={`${atRiskStudents.length} คน`}
          icon={AlertTriangle}
          tone="destructive"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <AiAssistantCard />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttendanceOverview attendance={attendanceSummary} />
            <AssignmentOverview assignments={assignmentSummaries} />
          </div>
          <QuickActions />
          <RecentActivity activity={activity.slice(0, 6)} />
        </div>

        <div className="space-y-4">
          <AttentionStudents students={attentionList} />
          <IntegrationStatus items={mockIntegrationStatus} />
        </div>
      </div>
    </div>
  )
}
