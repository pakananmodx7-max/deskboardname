import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { EditClassroomDialog } from '@/features/classroom-management/edit-classroom-dialog'
import { ClassroomOverviewTab } from '@/features/classroom-management/tabs/classroom-overview-tab'
import { ClassroomStudentsTab } from '@/features/classroom-management/tabs/classroom-students-tab'
import { AssignmentsTab } from '@/features/subjects-real/tabs/assignments-tab'
import { AttendanceTab } from '@/features/subjects-real/tabs/attendance-tab'
import { GradesTab } from '@/features/subjects-real/tabs/grades-tab'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { archiveClassroom, getClassroomById, reactivateClassroom } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getClassroomSubjects } from '@/services/subject-service'
import type { Classroom } from '@/types/classroom'
import type { Subject } from '@/types/subject'

type TabKey = 'overview' | 'students' | 'assignments' | 'attendance' | 'grades'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'assignments', label: 'งานและการบ้าน' },
  { key: 'attendance', label: 'เช็กชื่อ' },
  { key: 'grades', label: 'คะแนนและการประเมิน' },
]

/** The 3 tabs that need a subject to render — assignments/attendance/
 * grades are always subject+classroom scoped in this schema (see
 * AssignmentsTab/AttendanceTab/GradesTab's own props), never a bare
 * classroom-less concept, so this workspace can't show them until it
 * knows WHICH of the classroom's linked subjects the teacher means. */
const SUBJECT_SCOPED_TABS: ReadonlySet<TabKey> = new Set(['assignments', 'attendance', 'grades'])

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

/**
 * Requirement (Classroom Workspace consolidation): งานและการบ้าน,
 * เช็กชื่อ, and คะแนนและการประเมิน are no longer their own sidebar
 * destinations — they're tabs here, reached via ห้องเรียน → เลือกห้อง.
 * Each renders the EXACT SAME AssignmentsTab/AttendanceTab/GradesTab
 * components /teacher/subjects/:subjectId/classrooms/:classroomId
 * already uses (same services, same mutations — nothing duplicated),
 * just entered from the classroom side instead of the subject side.
 *
 * A classroom can be linked to more than one subject (e.g. a homeroom
 * taught Math AND Science by the same teacher), and assignments/
 * attendance/grades are always scoped to one specific subject — there is
 * no classroom-wide "all subjects' assignments merged together" concept
 * anywhere else in this app either. So when getClassroomSubjects finds
 * more than one linked subject, a small selector lets the teacher pick
 * which subject's data these 3 tabs show; with exactly one linked
 * subject (the common case) it's chosen automatically and the selector
 * never appears.
 */
export function ClassroomDetailPageReal() {
  const { classroomId } = useParams<{ classroomId: string }>()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  // Lets the Dashboard Control Center's "ดูนักเรียน" follow-up link open
  // straight to the นักเรียน tab via ?tab=students instead of always
  // landing on ภาพรวม first — see buildClassroomTabPath in
  // subject-classroom-nav.ts. Invalid/missing falls back to 'overview'.
  const initialTabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabKey>(isTabKey(initialTabParam) ? initialTabParam : 'overview')
  const [classroom, setClassroom] = useState<Classroom | null | undefined>(undefined)
  const [studentCount, setStudentCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const [linkedSubjects, setLinkedSubjects] = useState<Subject[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectsError, setSubjectsError] = useState<string | null>(null)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null)

  const loadStudentCount = useCallback((id: string) => {
    getStudentsByClassroom(id)
      .then((students) => setStudentCount(students.length))
      .catch(() => {
        // Overview stat only — the Students tab below surfaces its own error.
      })
  }, [])

  useEffect(() => {
    if (!classroomId) return
    let active = true

    getClassroomById(classroomId)
      .then((row) => {
        if (!active) return
        setClassroom(row)
        if (row) loadStudentCount(row.id)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })

    return () => {
      active = false
    }
  }, [classroomId, loadStudentCount])

  useEffect(() => {
    if (!classroomId) return
    let active = true
    setSubjectsLoading(true)
    setSubjectsError(null)

    getClassroomSubjects(classroomId)
      .then((subjects) => {
        if (!active) return
        setLinkedSubjects(subjects)
        setSelectedSubjectId((prev) => (prev && subjects.some((s) => s.id === prev) ? prev : (subjects[0]?.id ?? null)))
      })
      .catch((err: unknown) => {
        if (active) setSubjectsError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setSubjectsLoading(false)
      })

    return () => {
      active = false
    }
  }, [classroomId])

  if (!classroomId) {
    return <Navigate to="/teacher/classrooms" replace />
  }

  if (classroom === undefined) {
    return error ? <Navigate to="/teacher/classrooms" replace /> : <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  if (classroom === null) {
    return <Navigate to="/teacher/classrooms" replace />
  }

  // Re-bind to a fresh const so the nested function declaration below
  // (which TypeScript can't narrow through, since it's hoisted) still
  // sees a guaranteed-defined classroom instead of the original
  // possibly-null/undefined type.
  const currentClassroom = classroom
  const selectedSubject = linkedSubjects.find((s) => s.id === selectedSubjectId) ?? null

  async function handleToggleArchive() {
    setArchiving(true)
    try {
      const updated = currentClassroom.isActive
        ? await archiveClassroom(currentClassroom.id)
        : await reactivateClassroom(currentClassroom.id)
      setClassroom(updated)
      toast(updated.isActive ? 'เปิดใช้งานห้องเรียนอีกครั้งแล้ว' : 'เก็บถาวรห้องเรียนแล้ว')
    } catch (err) {
      toast(toFriendlyErrorMessage(err))
    } finally {
      setArchiving(false)
    }
  }

  function renderSubjectScopedTab(tab: 'assignments' | 'attendance' | 'grades') {
    if (subjectsLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
    if (subjectsError) return <p className="text-sm text-destructive">{subjectsError}</p>

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
    if (tab === 'attendance') {
      return <AttendanceTab subject={selectedSubject} classroomId={currentClassroom.id} classroomName={currentClassroom.name} />
    }
    return <GradesTab subject={selectedSubject} classroomId={currentClassroom.id} classroomName={currentClassroom.name} />
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-4 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{classroom.name}</h1>
              {!classroom.isActive && <Badge variant="outline">เก็บถาวร</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                classroom.gradeLevel,
                classroom.academicYear && `ปีการศึกษา ${classroom.academicYear}`,
                classroom.semester && `ภาคเรียนที่ ${classroom.semester}`,
              ]
                .filter(Boolean)
                .join(' · ') || '-'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              แก้ไข
            </Button>
            <Button variant="outline" size="sm" onClick={handleToggleArchive} disabled={archiving}>
              {classroom.isActive ? 'เก็บถาวร' : 'เปิดใช้งานอีกครั้ง'}
            </Button>
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
        {activeTab === 'overview' && <ClassroomOverviewTab classroom={classroom} studentCount={studentCount} />}
        {activeTab === 'students' && <ClassroomStudentsTab classroom={classroom} />}
        {activeTab === 'assignments' && renderSubjectScopedTab('assignments')}
        {activeTab === 'attendance' && renderSubjectScopedTab('attendance')}
        {activeTab === 'grades' && renderSubjectScopedTab('grades')}
      </div>

      <EditClassroomDialog open={editOpen} onOpenChange={setEditOpen} classroom={classroom} onUpdated={setClassroom} />
    </div>
  )
}
