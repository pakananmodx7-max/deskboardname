import { useCallback, useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ClassroomOverviewTab } from '@/features/classroom-management/tabs/classroom-overview-tab'
import { ClassroomStudentsTab } from '@/features/classroom-management/tabs/classroom-students-tab'
import { EditClassroomDialog } from '@/features/classroom-management/edit-classroom-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { archiveClassroom, getClassroomById, reactivateClassroom } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Classroom } from '@/types/classroom'

type TabKey = 'overview' | 'students'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
]

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

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
          <div className="flex gap-2">
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
      </div>

      <EditClassroomDialog open={editOpen} onOpenChange={setEditOpen} classroom={classroom} onUpdated={setClassroom} />
    </div>
  )
}
