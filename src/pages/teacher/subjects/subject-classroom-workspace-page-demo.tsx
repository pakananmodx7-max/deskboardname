import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/select'
import { useDemoClassroom } from '@/demo/demo-context'
import { AssignmentsTab } from '@/features/demo-subjects/tabs/assignments-tab'
import { AttendanceTab } from '@/features/demo-subjects/tabs/attendance-tab'
import { GradesTab } from '@/features/demo-subjects/tabs/grades-tab'
import { LessonsTab } from '@/features/demo-subjects/tabs/lessons-tab'
import { OverviewTab } from '@/features/demo-subjects/tabs/overview-tab'
import { StudentsTab } from '@/features/demo-subjects/tabs/students-tab'
import { buildSubjectClassroomPath, isClassroomLinkedToSubject } from '@/features/subjects-shared/subject-classroom-nav'
import { cn } from '@/lib/utils'

type TabKey = 'overview' | 'students' | 'attendance' | 'lessons' | 'assignments' | 'grades'

/** Exported so the exact tab set — and specifically that Topics is gone
 * — is unit-testable without rendering. See
 * subject-classroom-workspace-page.test.ts. */
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'attendance', label: 'เช็คชื่อ' },
  { key: 'lessons', label: 'บทเรียน' },
  { key: 'assignments', label: 'งาน' },
  { key: 'grades', label: 'คะแนน' },
]

/** Demo mirror of subjects-real's classroom workspace page — identical
 * tab set (no Topics tab — see subjects-real's workspace page for why)
 * and classroom-scoping rules, backed by demo state instead of Supabase.
 * See that file for the full design rationale. */
export function SubjectClassroomWorkspacePageDemo() {
  const { subjectId, classroomId } = useParams<{ subjectId: string; classroomId: string }>()
  const { subjects, classrooms } = useDemoClassroom()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const subject = subjects.find((s) => s.id === subjectId)

  if (!subject || !subjectId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  const links = subject.classroomIds.map((id) => ({ classroomId: id }))
  if (!isClassroomLinkedToSubject(links, classroomId)) {
    return <Navigate to={`/teacher/subjects/${subjectId}`} replace />
  }
  const activeClassroomId = classroomId as string

  const classroom = classrooms.find((c) => c.id === activeClassroomId)

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
              {classroom?.name ?? '-'} · {classroom?.studentIds.length ?? 0} คน
            </p>
          </div>

          {subject.classroomIds.length > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">ห้อง:</span>
              <NativeSelect
                value={activeClassroomId}
                onChange={(e) => navigate(buildSubjectClassroomPath(subjectId, e.target.value))}
                className="w-auto"
                aria-label="สลับห้องเรียน"
              >
                {subject.classroomIds.map((id) => (
                  <option key={id} value={id}>
                    {classrooms.find((c) => c.id === id)?.name ?? id}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
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
        {activeTab === 'overview' && <OverviewTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'students' && <StudentsTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'attendance' && <AttendanceTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'lessons' && <LessonsTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'assignments' && <AssignmentsTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'grades' && <GradesTab subject={subject} classroomId={activeClassroomId} />}
      </div>
    </div>
  )
}
