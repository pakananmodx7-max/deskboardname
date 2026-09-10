import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/select'
import { AssignmentsTab } from '@/features/subjects-real/tabs/assignments-tab'
import { AttendanceTab } from '@/features/subjects-real/tabs/attendance-tab'
import { GradesTab } from '@/features/subjects-real/tabs/grades-tab'
import { LessonsTab } from '@/features/subjects-real/tabs/lessons-tab'
import { OverviewTab } from '@/features/subjects-real/tabs/overview-tab'
import { StudentsTab } from '@/features/subjects-real/tabs/students-tab'
import { buildSubjectClassroomPath, isClassroomLinkedToSubject } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getSubjectById, getSubjectClassroomsWithCounts } from '@/services/subject-service'
import type { Subject, SubjectClassroomWithCount } from '@/types/subject'

type TabKey = 'overview' | 'students' | 'attendance' | 'lessons' | 'assignments' | 'grades'

/** Exported (rather than kept module-private) so the exact tab set — and
 * specifically that Topics is gone — is unit-testable without rendering.
 * See subject-classroom-workspace-page.test.ts.
 *
 * บทเรียน (Lessons) sits between เช็คชื่อ and งาน — teacher-organized
 * learning materials (slides/videos/documents/links), completely
 * separate from the assignment workflow (see 0015_lessons.sql). */
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'attendance', label: 'เช็คชื่อ' },
  { key: 'lessons', label: 'บทเรียน' },
  { key: 'assignments', label: 'งาน' },
  { key: 'grades', label: 'คะแนน' },
]

/**
 * The subject + classroom workspace — "Subjects → open Subject → choose
 * Classroom → manage that classroom inside the subject." Everything here
 * (Overview's student count, Students, Attendance, Assignments, Grades)
 * is scoped to exactly the `classroomId` route param.
 *
 * No Topics tab here on purpose — it was removed from this workspace to
 * simplify the UI (topics/description/max score/due date/submission
 * status/score cover what a teacher actually manages day to day). The
 * `topics` table, RLS, topic-service.ts, and TopicsTab component are all
 * left completely untouched for possible future use — this is a UI-only
 * removal, not a schema or backend change. See
 * subjects-real/tabs/topics-tab.tsx (now unreferenced) and
 * docs/DATABASE.md's Phase 9 note.
 *
 * งาน (Assignments) and คะแนน (Grades) are both real and classroom-scoped.
 * Grades is a derived view over assignments + assignment_submissions.score
 * (see grades-tab.tsx and assignment-service.ts's computeGradeRows) —
 * there is no separate grades table, matching 0006's "Future relationship"
 * note.
 */
function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

export function SubjectClassroomWorkspacePageReal() {
  const { subjectId, classroomId } = useParams<{ subjectId: string; classroomId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Lets a caller (e.g. the Dashboard Control Center's "เช็คชื่อ"/"ให้คะแนน"
  // deep links) open this workspace straight to a specific tab via
  // ?tab=attendance instead of always landing on ภาพรวม — see
  // buildSubjectClassroomTabPath in subject-classroom-nav.ts, the one
  // place this query string is built. An invalid/missing value falls
  // back to 'overview'.
  const initialTabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabKey>(isTabKey(initialTabParam) ? initialTabParam : 'overview')

  const [subject, setSubject] = useState<Subject | null | undefined>(undefined)
  const [links, setLinks] = useState<SubjectClassroomWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId) return
    let active = true
    setLoading(true)
    setError(null)

    getSubjectById(subjectId)
      .then(async (row) => {
        if (!active) return
        setSubject(row)
        if (!row) return
        const linkRows = await getSubjectClassroomsWithCounts(row.id)
        if (active) setLinks(linkRows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [subjectId])

  if (!subjectId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  if (subject === undefined || loading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  if (subject === null) {
    return <Navigate to="/teacher/subjects" replace />
  }

  // Closes the "type an unlinked/foreign classroom id into the URL" path —
  // a classroomId that isn't (or is no longer) linked to this subject
  // bounces back to the subject root instead of silently rendering it.
  if (!isClassroomLinkedToSubject(links, classroomId)) {
    return <Navigate to={`/teacher/subjects/${subjectId}`} replace />
  }

  const activeClassroomId = classroomId as string
  const currentLink = links.find((link) => link.classroomId === activeClassroomId)!

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
              {currentLink.classroomName} · {currentLink.studentCount} คน
            </p>
          </div>

          {links.length > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">ห้อง:</span>
              <NativeSelect
                value={activeClassroomId}
                onChange={(e) => navigate(buildSubjectClassroomPath(subjectId, e.target.value))}
                className="w-auto"
                aria-label="สลับห้องเรียน"
              >
                {links.map((link) => (
                  <option key={link.id} value={link.classroomId}>
                    {link.classroomName}
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div>
        {activeTab === 'overview' && <OverviewTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'students' && (
          <StudentsTab
            subjectName={subject.name}
            classroomId={activeClassroomId}
            classroomName={currentLink.classroomName ?? ''}
          />
        )}
        {activeTab === 'attendance' && (
          <AttendanceTab subject={subject} classroomId={activeClassroomId} classroomName={currentLink.classroomName ?? ''} />
        )}
        {activeTab === 'lessons' && <LessonsTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'assignments' && <AssignmentsTab subject={subject} classroomId={activeClassroomId} />}
        {activeTab === 'grades' && (
          <GradesTab subject={subject} classroomId={activeClassroomId} classroomName={currentLink.classroomName ?? ''} />
        )}
      </div>
    </div>
  )
}
