import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentIdsForClassrooms } from '@/demo/subject-selectors'
import { AssignmentsTab } from '@/features/demo-subjects/tabs/assignments-tab'
import { AttendanceTab } from '@/features/demo-subjects/tabs/attendance-tab'
import { GradesTab } from '@/features/demo-subjects/tabs/grades-tab'
import { OverviewTab } from '@/features/demo-subjects/tabs/overview-tab'
import { StudentsTab } from '@/features/demo-subjects/tabs/students-tab'
import { TopicsTab } from '@/features/demo-subjects/tabs/topics-tab'
import { cn } from '@/lib/utils'

type TabKey = 'overview' | 'students' | 'attendance' | 'topics' | 'assignments' | 'grades'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'attendance', label: 'เช็คชื่อ' },
  { key: 'topics', label: 'หัวข้อ' },
  { key: 'assignments', label: 'งาน' },
  { key: 'grades', label: 'คะแนน' },
]

export function SubjectDetailPageDemo() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { subjects, classrooms } = useDemoClassroom()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const subject = subjects.find((s) => s.id === subjectId)

  if (!subject) {
    return <Navigate to="/teacher/subjects" replace />
  }

  const studentIds = getStudentIdsForClassrooms(subject.classroomIds, classrooms)
  const classroomNames = subject.classroomIds
    .map((id) => classrooms.find((c) => c.id === id)?.name)
    .filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{subject.name}</h1>
              <Badge variant="outline">{subject.code}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {classroomNames.join(', ')} · {studentIds.length} คน · ปีการศึกษา {subject.academicYear} ภาคเรียนที่{' '}
              {subject.semester}
            </p>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {activeTab === 'overview' && <OverviewTab subject={subject} />}
        {activeTab === 'students' && <StudentsTab subject={subject} />}
        {activeTab === 'attendance' && <AttendanceTab subject={subject} />}
        {activeTab === 'topics' && <TopicsTab subject={subject} />}
        {activeTab === 'assignments' && <AssignmentsTab subject={subject} />}
        {activeTab === 'grades' && <GradesTab subject={subject} />}
      </div>
    </div>
  )
}
