import { Users } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoSubject } from '@/demo/types'
import { ClassroomStudentsTab } from '@/features/classroom-management-demo/classroom-students-tab'
import { AssignmentsTab } from '@/features/demo-subjects/tabs/assignments-tab'
import { AttendanceTab } from '@/features/demo-subjects/tabs/attendance-tab'
import { GradesTab } from '@/features/demo-subjects/tabs/grades-tab'
import { cn } from '@/lib/utils'

type TabKey = 'overview' | 'students' | 'assignments' | 'attendance' | 'grades'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'assignments', label: 'งานและการบ้าน' },
  { key: 'attendance', label: 'เช็กชื่อ' },
  { key: 'grades', label: 'คะแนนและการประเมิน' },
]

const SUBJECT_SCOPED_TABS: ReadonlySet<TabKey> = new Set(['assignments', 'attendance', 'grades'])

/** Demo mirror of classroom-detail-page-real.tsx — see that file for the
 * full design rationale on why assignments/attendance/grades need a
 * selected subject and why a subject picker only appears when the
 * classroom is linked to more than one. */
export function ClassroomDetailPageDemo() {
  const { classroomId } = useParams<{ classroomId: string }>()
  const { classrooms, allStudents, subjects } = useDemoClassroom()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const classroom = classrooms.find((c) => c.id === classroomId)
  const linkedSubjects = subjects.filter((s) => s.classroomIds.includes(classroomId ?? ''))
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(linkedSubjects[0]?.id ?? null)

  if (!classroom) {
    return <Navigate to="/teacher/classrooms" replace />
  }

  // Re-bind to a fresh const so the nested renderSubjectScopedTab
  // function below (which TypeScript can't narrow through, since it's
  // hoisted) still sees a guaranteed-defined classroom.
  const currentClassroom = classroom
  const students = allStudents.filter((s) => classroom.studentIds.includes(s.id)).sort((a, b) => a.number - b.number)
  const selectedSubject: DemoSubject | null =
    linkedSubjects.find((s) => s.id === selectedSubjectId) ?? linkedSubjects[0] ?? null

  function renderSubjectScopedTab(tab: 'assignments' | 'attendance' | 'grades') {
    if (linkedSubjects.length === 0) {
      return (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm font-medium">ห้องเรียนนี้ยังไม่ได้เชื่อมกับรายวิชาใด</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              เชื่อมห้องเรียนนี้กับรายวิชาก่อน จึงจะมอบหมายงาน เช็กชื่อ หรือให้คะแนนได้
            </p>
            <Button asChild>
              <Link to="/teacher/subjects">ไปที่รายวิชา</Link>
            </Button>
          </CardContent>
        </Card>
      )
    }

    if (!selectedSubject) return null

    if (tab === 'assignments') return <AssignmentsTab subject={selectedSubject} classroomId={currentClassroom.id} />
    if (tab === 'attendance') return <AttendanceTab subject={selectedSubject} classroomId={currentClassroom.id} />
    return <GradesTab subject={selectedSubject} classroomId={currentClassroom.id} />
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{classroom.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{students.length} คน</p>
          </div>
          {SUBJECT_SCOPED_TABS.has(activeTab) && linkedSubjects.length > 1 && (
            <NativeSelect
              value={selectedSubjectId ?? ''}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-auto"
              aria-label="เลือกรายวิชา"
            >
              {linkedSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </NativeSelect>
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
      {activeTab === 'assignments' && renderSubjectScopedTab('assignments')}
      {activeTab === 'attendance' && renderSubjectScopedTab('attendance')}
      {activeTab === 'grades' && renderSubjectScopedTab('grades')}
    </div>
  )
}
