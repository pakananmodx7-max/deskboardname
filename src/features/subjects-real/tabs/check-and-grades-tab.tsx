import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import type { Subject } from '@/types/subject'
import { GradesTab } from './grades-tab'
import { SubmissionCheckTab } from './submission-check-tab'

type CheckAndGradesSubTab = 'submissionCheck' | 'grades'

/** Exported so the exact sub-tab set/order/default is unit-testable
 * without rendering — see check-and-grades-tab.test.ts. */
export const SUB_TABS: { key: CheckAndGradesSubTab; label: string }[] = [
  { key: 'submissionCheck', label: 'ตรวจสอบงาน' },
  { key: 'grades', label: 'คะแนน' },
]

function isSubTabKey(value: string | null): value is CheckAndGradesSubTab {
  return SUB_TABS.some((tab) => tab.key === value)
}

interface CheckAndGradesTabProps {
  subject: Subject
  classroomId: string
  classroomName: string
}

/**
 * ตรวจงานและคะแนน — a thin container merging what used to be two
 * separate top-level tabs (ตรวจสอบงาน, คะแนน) into one, with the same two
 * screens now reached as inner sub-tabs instead. This component owns
 * NOTHING but which of the two to show: SubmissionCheckTab and
 * GradesTab are rendered completely UNCHANGED (same props, same
 * internal data fetching via getAssignments/getSubmissions, same
 * setSubmissionScore write path, same submitted-but-ungraded-is-not-0
 * rule) — neither shares state with the other, exactly as when they
 * were independent top-level tabs; merging them here duplicates no
 * fetch and no business logic.
 *
 * The sub-tab choice is mirrored into `?subtab=` (merged with whatever
 * `?tab=` the parent workspace page already manages) so a browser
 * refresh or a direct/shared link can land straight back on the
 * sub-tab the teacher was on, the same `?tab=` convention
 * subject-classroom-workspace-page-real.tsx already uses one level up.
 */
export function CheckAndGradesTab({ subject, classroomId, classroomName }: CheckAndGradesTabProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSubTabParam = searchParams.get('subtab')
  const [subTab, setSubTab] = useState<CheckAndGradesSubTab>(
    isSubTabKey(initialSubTabParam) ? initialSubTabParam : 'submissionCheck',
  )

  function handleSubTabClick(key: CheckAndGradesSubTab) {
    setSubTab(key)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('subtab', key)
        return next
      },
      { replace: true },
    )
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex gap-0.5 rounded-lg border border-border bg-muted/40 p-1">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleSubTabClick(tab.key)}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              subTab === tab.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'submissionCheck' && <SubmissionCheckTab subject={subject} classroomId={classroomId} />}
      {subTab === 'grades' && <GradesTab subject={subject} classroomId={classroomId} classroomName={classroomName} />}
    </div>
  )
}
