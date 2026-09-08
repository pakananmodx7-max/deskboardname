import { Users } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import { ClassroomStudentsTab } from '@/features/classroom-management-demo/classroom-students-tab'
import { cn } from '@/lib/utils'

type TabKey = 'overview' | 'students'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
]

export function ClassroomDetailPageDemo() {
  const { classroomId } = useParams<{ classroomId: string }>()
  const { classrooms, allStudents } = useDemoClassroom()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const classroom = classrooms.find((c) => c.id === classroomId)

  if (!classroom) {
    return <Navigate to="/teacher/classrooms" replace />
  }

  const students = allStudents.filter((s) => classroom.studentIds.includes(s.id)).sort((a, b) => a.number - b.number)

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="pt-1">
          <h1 className="text-xl font-semibold tracking-tight">{classroom.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{students.length} คน</p>
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

      {activeTab === 'overview' && (
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">นักเรียนทั้งหมด</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{students.length} คน</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'students' && <ClassroomStudentsTab classroom={classroom} students={students} />}
    </div>
  )
}
