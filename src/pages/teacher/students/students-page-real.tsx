import { useCallback, useEffect, useState } from 'react'

import { ClassroomSelector } from '@/features/classroom-management/classroom-selector'
import { NoClassroomsEmptyState } from '@/features/classroom-management/no-classrooms-empty-state'
import { ClassroomStudentsTab } from '@/features/classroom-management/tabs/classroom-students-tab'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassrooms } from '@/services/classroom-service'
import type { Classroom } from '@/types/classroom'

/**
 * Real students are always scoped to a classroom (there is no
 * cross-classroom `students` read in the schema/RLS — see
 * docs/DATABASE.md), unlike the demo page's flat, all-classrooms roster.
 * So real mode adds a classroom selector and reuses
 * ClassroomStudentsTab — the exact same component (and, through it, the
 * same real StudentImportDialog / AddStudentDialog) already used by
 * /teacher/classrooms/:classroomId — instead of re-implementing list +
 * add + import a second time.
 */
export function StudentsPageReal() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getClassrooms()
      .then((rows) => {
        setClassrooms(rows)
        setSelectedClassroomId((prev) => (prev && rows.some((c) => c.id === prev) ? prev : (rows[0]?.id ?? null)))
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function handleClassroomCreated(classroom: Classroom) {
    setClassrooms((prev) => [...prev, classroom])
    setSelectedClassroomId(classroom.id)
  }

  const selectedClassroom = classrooms.find((c) => c.id === selectedClassroomId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายชื่อนักเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? 'กำลังโหลด...' : (selectedClassroom?.name ?? '-')}
          </p>
        </div>
        {classrooms.length > 0 && (
          <ClassroomSelector
            classrooms={classrooms}
            selectedClassroomId={selectedClassroomId}
            onSelect={setSelectedClassroomId}
            onCreated={handleClassroomCreated}
          />
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : classrooms.length === 0 ? (
        <NoClassroomsEmptyState onCreated={handleClassroomCreated} />
      ) : (
        selectedClassroom && <ClassroomStudentsTab classroom={selectedClassroom} />
      )}
    </div>
  )
}
