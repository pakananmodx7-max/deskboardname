import { FileText, ListChecks, School } from 'lucide-react'

import { useDemoClassroom } from '@/demo/demo-context'
import { HermesSummaryCard } from '@/features/home/hermes-summary-card'
import { ModuleSummaryCard } from '@/features/home/module-summary-card'

/** Demo-mode counterpart of home-page-real.tsx — same layout, but every
 * number comes from the existing demo-context state (the same source
 * dashboard-page-demo.tsx already reads), never a hardcoded figure. */
export function HomePageDemo() {
  const { classroomName, students, subjects, studentsWithMissingWork } = useDemoClassroom()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">สวัสดี, ครู</h1>
        <p className="mt-1 text-sm text-muted-foreground">นี่คือภาพรวมของทุกระบบที่คุณใช้งานอยู่</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModuleSummaryCard
          icon={School}
          title="ระบบจัดการชั้นเรียน"
          subtitle="Classroom Management System"
          to="/teacher/classroom-management"
          stats={[
            { label: 'ห้องเรียน', value: `${classroomName ? 1 : 0}` },
            { label: 'นักเรียน', value: `${students.length}` },
            { label: 'รายวิชา', value: `${subjects.length}` },
          ]}
          description={studentsWithMissingWork > 0 ? `มีนักเรียน ${studentsWithMissingWork} คนที่มีงานค้าง` : undefined}
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
