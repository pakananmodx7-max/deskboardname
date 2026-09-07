import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { DemoOnlyNotice } from '@/features/subjects-real/demo-only-notice'
import { OverviewTab } from '@/features/subjects-real/tabs/overview-tab'
import { StudentsTab } from '@/features/subjects-real/tabs/students-tab'
import { TopicsTab } from '@/features/subjects-real/tabs/topics-tab'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getSubjectClassrooms, getSubjectById, getSubjectStudents } from '@/services/subject-service'
import type { Subject, SubjectClassroom } from '@/types/subject'

type TabKey = 'overview' | 'students' | 'attendance' | 'topics' | 'assignments' | 'grades'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'attendance', label: 'เช็คชื่อ' },
  { key: 'topics', label: 'หัวข้อ' },
  { key: 'assignments', label: 'งาน' },
  { key: 'grades', label: 'คะแนน' },
]

export function SubjectDetailPageReal() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [subject, setSubject] = useState<Subject | null | undefined>(undefined)
  const [classroomLinks, setClassroomLinks] = useState<SubjectClassroom[]>([])
  const [studentCount, setStudentCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId) return
    let active = true

    getSubjectById(subjectId)
      .then(async (row) => {
        if (!active) return
        setSubject(row)
        if (!row) return
        const [links, students] = await Promise.all([getSubjectClassrooms(row.id), getSubjectStudents(row.id)])
        if (!active) return
        setClassroomLinks(links)
        setStudentCount(students.length)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })

    return () => {
      active = false
    }
  }, [subjectId])

  if (!subjectId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  if (subject === undefined) {
    return error ? <Navigate to="/teacher/subjects" replace /> : <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  if (subject === null) {
    return <Navigate to="/teacher/subjects" replace />
  }

  const classroomNames = classroomLinks.map((link) => link.classroomName).filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{subject.name}</h1>
              {subject.subjectCode && <Badge variant="outline">{subject.subjectCode}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {classroomNames.join(', ')} · {studentCount ?? 0} คน
              {subject.academicYear ? ` · ปีการศึกษา ${subject.academicYear}` : ''}
              {subject.semester ? ` ภาคเรียนที่ ${subject.semester}` : ''}
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
        {activeTab === 'attendance' && <DemoOnlyNotice featureLabel="เช็คชื่อ" />}
        {activeTab === 'topics' && <TopicsTab subject={subject} />}
        {activeTab === 'assignments' && <DemoOnlyNotice featureLabel="งาน" />}
        {activeTab === 'grades' && <DemoOnlyNotice featureLabel="คะแนน" />}
      </div>
    </div>
  )
}
