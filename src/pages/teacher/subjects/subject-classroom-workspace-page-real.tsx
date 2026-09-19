import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/select'
import { AttendanceTab } from '@/features/subjects-real/tabs/attendance-tab'
import { CheckAndGradesTab } from '@/features/subjects-real/tabs/check-and-grades-tab'
import { LessonsTab } from '@/features/subjects-real/tabs/lessons-tab'
import { OverviewTab } from '@/features/subjects-real/tabs/overview-tab'
import { StudentsTab } from '@/features/subjects-real/tabs/students-tab'
import { buildSubjectClassroomPath, isClassroomLinkedToSubject } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getSubjectById, getSubjectClassroomsWithCounts } from '@/services/subject-service'
import type { Subject, SubjectClassroomWithCount } from '@/types/subject'

type TabKey = 'overview' | 'students' | 'attendance' | 'lessons' | 'checkAndGrades'

/** Exported (rather than kept module-private) so the exact tab set — and
 * specifically that Topics is gone — is unit-testable without rendering.
 * See subject-classroom-workspace-page.test.ts.
 *
 * บทเรียน (Lessons) sits between เช็คชื่อ and ตรวจงานและคะแนน —
 * teacher-organized learning materials (slides/videos/documents/links),
 * completely separate from the assignment workflow (see 0015_lessons.sql).
 *
 * งาน is GONE as a top-level tab: the old assignment card-grid workflow
 * (open assignment 1 → check students → back → open assignment 2 → ...)
 * is superseded by ตรวจงานและคะแนน's own student × assignment matrix,
 * which already has "+ สร้างงาน" and per-column แก้ไขงาน/ดูรายละเอียด/
 * bulk actions/archive/delete (see check-and-grades-tab.tsx and
 * submission-check-tab.tsx). AssignmentsTab itself is NOT deleted — it's
 * still used by the separate, unrelated /teacher/classrooms/:id page
 * (classroom-detail-page-real.tsx) — this removal only touches where
 * THIS workspace's tab row points. A bookmarked/old `?tab=assignments`
 * link still works: resolveInitialTab() below silently redirects it to
 * 'checkAndGrades' rather than 404ing or falling back to ภาพรวม.
 *
 * ตรวจงานและคะแนน merges the formerly separate ตรวจสอบงาน and คะแนน
 * top-level tabs into this ONE tab, with ตรวจสอบงาน/คะแนน as inner
 * sub-tabs instead (see check-and-grades-tab.tsx). Every other tab
 * keeps its prior relative order/key, so no other existing ?tab= deep
 * link changes.
 *
 * นักเรียน stays a fully valid tab (isTabKey/`?tab=students` deep links —
 * e.g. buildClassroomTabPath-style links from elsewhere — keep working
 * exactly as before) but is no longer rendered as one of the pill
 * buttons in PILL_TABS below: it's reached instead through the
 * "รายชื่อนักเรียน" action button next to the ห้อง selector, so the main
 * tab row stays focused on the day-to-day ภาพรวม/เช็กชื่อ/บทเรียน/
 * ตรวจงานและคะแนน flow. StudentsTab itself is completely unchanged. */
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'students', label: 'นักเรียน' },
  { key: 'attendance', label: 'เช็กชื่อ' },
  { key: 'lessons', label: 'บทเรียน' },
  { key: 'checkAndGrades', label: 'ตรวจงานและคะแนน' },
]

/** The tabs actually rendered as pill buttons — TABS minus นักเรียน (see
 * the doc comment above). Exported alongside TABS so both the full
 * valid-key set and the visible pill set are independently
 * unit-testable. */
export const PILL_TABS = TABS.filter((tab) => tab.key !== 'students')

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

/** Old `?tab=` values that no longer name a real tab, mapped to the tab
 * that now covers what they used to show — a plain object (not part of
 * TabKey) so an old bookmark/link/deep-link builder still lands
 * somewhere real instead of silently falling back to ภาพรวม. 'grades'
 * is included too even though nothing in this codebase currently builds
 * that link (buildSubjectClassroomTabPath's own type still allows it,
 * kept for exactly this reason) — both 'assignments' and 'grades' were
 * absorbed into ตรวจงานและคะแนน. */
const LEGACY_TAB_REDIRECTS: Record<string, TabKey> = {
  assignments: 'checkAndGrades',
  grades: 'checkAndGrades',
}

function resolveInitialTab(value: string | null): TabKey {
  if (isTabKey(value)) return value
  if (value && value in LEGACY_TAB_REDIRECTS) return LEGACY_TAB_REDIRECTS[value]
  return 'overview'
}

/**
 * The subject + classroom workspace — "Subjects → open Subject → choose
 * Classroom → manage that classroom inside the subject." Everything here
 * (Overview's student count, Students, Attendance, Lessons, ตรวจงานและ
 * คะแนน) is scoped to exactly the `classroomId` route param.
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
 * ตรวจงานและคะแนน is a derived view over assignments + assignment_
 * submissions.status/score (see check-and-grades-tab.tsx,
 * submission-check-tab.tsx, grades-tab.tsx, and assignment-service.ts's
 * computeGradeRows) — there is no separate grades table, matching
 * 0006's "Future relationship" note.
 */

export function SubjectClassroomWorkspacePageReal() {
  const { subjectId, classroomId } = useParams<{ subjectId: string; classroomId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Lets a caller (e.g. the Dashboard Control Center's "เช็คชื่อ"/"ให้คะแนน"
  // deep links) open this workspace straight to a specific tab via
  // ?tab=attendance instead of always landing on ภาพรวม — see
  // buildSubjectClassroomTabPath in subject-classroom-nav.ts, the one
  // place this query string is built. An invalid/missing value falls
  // back to 'overview'; a LEGACY value (e.g. an old ?tab=assignments
  // bookmark from before งาน was removed as a top-level tab) resolves to
  // whichever current tab now covers it — see resolveInitialTab/
  // LEGACY_TAB_REDIRECTS above.
  const initialTabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabKey>(resolveInitialTab(initialTabParam))

  // Keeps ?tab= in sync with every click (not just the initial deep
  // link) — this is what lets ตรวจงานและคะแนน's own inner ?subtab=
  // (see check-and-grades-tab.tsx) survive a refresh: without ?tab=
  // itself also surviving, the page would land back on ภาพรวม first and
  // the inner sub-tab would never even be reached. `replace: true` so
  // clicking through tabs doesn't spam the browser history stack.
  function handleTabClick(key: TabKey) {
    setActiveTab(key)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', key)
        return next
      },
      { replace: true },
    )
  }

  // Rewrites a legacy ?tab= value (e.g. ?tab=assignments) in the address
  // bar itself, once, right after the redirect above already resolved
  // `activeTab` — so a bookmarked old link both RENDERS the right tab
  // immediately AND stops pointing at a value that no longer exists the
  // moment the teacher refreshes or shares the URL again.
  useEffect(() => {
    if (initialTabParam && initialTabParam in LEGACY_TAB_REDIRECTS) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', LEGACY_TAB_REDIRECTS[initialTabParam])
          return next
        },
        { replace: true },
      )
    }
    // Only ever needs to run once, against the URL's ORIGINAL value —
    // handleTabClick above takes over ?tab= for every click afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      <div className="sticky top-0 z-10 -mx-4 space-y-3 border-b border-border bg-background px-4 pb-0 pt-0 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-foreground">{subject.name}</h1>
              {subject.subjectCode && <Badge variant="outline">{subject.subjectCode}</Badge>}
            </div>
            <p className="mt-0.5 text-sm font-medium text-muted-foreground">
              {currentLink.classroomName} · {currentLink.studentCount} คน
            </p>
          </div>

          <div className="flex items-center gap-2">
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
            <Button
              type="button"
              variant={activeTab === 'students' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleTabClick('students')}
            >
              <Users className="size-4" />
              รายชื่อนักเรียน
            </Button>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-3">
          {PILL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabClick(tab.key)}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground',
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
        {activeTab === 'checkAndGrades' && (
          <CheckAndGradesTab subject={subject} classroomId={activeClassroomId} classroomName={currentLink.classroomName ?? ''} />
        )}
      </div>
    </div>
  )
}
