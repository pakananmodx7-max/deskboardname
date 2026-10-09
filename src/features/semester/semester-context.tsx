import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { useDemoClassroom } from '@/demo/demo-context'
import { todayIso } from '@/features/classroom-analytics/analytics'
import { buildDemoAnalyticsDataset } from '@/features/classroom-analytics/demo-adapter'
import { success } from '@/features/classroom-analytics/resource'
import { supabaseAnalyticsLoaders, useKeyedResource } from '@/features/classroom-analytics/use-classroom-analytics'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { getSupabaseClient } from '@/lib/supabase'

import { parseSemesterPreference, SEMESTER_METADATA_KEY, type SemesterPreference } from './semester-preference'
import { useSemesterSelection } from './semester-selection'
import { SemesterContext, type SemesterContextValue } from './semester-store'

const loadContext = () => supabaseAnalyticsLoaders.context()

function RealSemesterProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const ownerId = user?.id ?? 'anonymous'
  const [revision, setRevision] = useState(0)
  const current = useKeyedResource(`context:${revision}`, loadContext)
  // While a refresh is loading, keep showing the previous classrooms.
  const previous = revision > 0 ? current.peek(`context:${revision - 1}`) : undefined
  const context = current.resource.status === 'loading' && previous?.status === 'success' ? previous : current.resource

  const remote = parseSemesterPreference(user?.user_metadata?.[SEMESTER_METADATA_KEY])
  const persistRemote = useCallback(
    (preference: SemesterPreference) => {
      if (!user) return
      // Best effort — the teacher's own auth metadata only; a failure
      // leaves the localStorage copy in place.
      void getSupabaseClient()
        .auth.updateUser({ data: { [SEMESTER_METADATA_KEY]: preference } })
        .catch(() => undefined)
    },
    [user],
  )
  const selection = useSemesterSelection(ownerId, context, remote, persistRemote)

  const value = useMemo<SemesterContextValue>(
    () => ({
      context,
      retryContext: current.retry,
      refreshContext: () => setRevision((r) => r + 1),
      ...selection,
    }),
    [context, current.retry, selection],
  )
  return <SemesterContext.Provider value={value}>{children}</SemesterContext.Provider>
}

function DemoSemesterProvider({ children }: { children: ReactNode }) {
  const demo = useDemoClassroom()
  const context = useMemo(
    () =>
      success(
        buildDemoAnalyticsDataset(
          {
            classroomName: demo.classroomName,
            classrooms: demo.classrooms,
            allStudents: demo.allStudents,
            subjects: demo.subjects,
            subjectAssignments: demo.subjectAssignments,
            subjectAttendance: demo.subjectAttendance,
            attendance: demo.attendance,
          },
          todayIso(),
        ).context,
      ),
    [demo.classroomName, demo.classrooms, demo.allStudents, demo.subjects, demo.subjectAssignments, demo.subjectAttendance, demo.attendance],
  )
  const selection = useSemesterSelection('demo', context, null, null)
  const value = useMemo<SemesterContextValue>(() => ({ context, retryContext: () => {}, refreshContext: () => {}, ...selection }), [context, selection])
  return <SemesterContext.Provider value={value}>{children}</SemesterContext.Provider>
}

export function SemesterProvider({ children }: { children: ReactNode }) {
  return dataMode === 'supabase' ? <RealSemesterProvider>{children}</RealSemesterProvider> : <DemoSemesterProvider>{children}</DemoSemesterProvider>
}
