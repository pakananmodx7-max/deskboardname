import { CalendarCheck, ClipboardList, Users, type LucideIcon } from 'lucide-react'

import {
  buildAssignmentDetailPath,
  buildClassroomTabPath,
  buildSubjectClassroomTabPath,
} from '@/features/subjects-shared/subject-classroom-nav'
import { selectAssignmentsNeedingAttention, type AssignmentActionItem, type TodayAttendanceStatus } from '@/services/dashboard-service'
import type { FollowUpRow } from '@/types/report'

/**
 * One row in the unified worklist ("things needing a decision") shown at
 * three altitudes — Home (every classroom), Classroom Management ภาพรวม
 * (every classroom), and a single classroom's own ภาพรวม tab (that
 * classroom only, via the optional classroomId param on the 3 functions
 * below). Every mapper here is pure and reuses the exact deep-link
 * builders the previous, separate cards already used (see
 * today-attendance-card.tsx / assignment-action-card.tsx /
 * dashboard-followup-card.tsx) — nothing about where a click lands
 * changed, only that the three lists now render as one.
 */
export interface WorklistItem {
  id: string
  icon: LucideIcon
  title: string
  meta: string
  badgeLabel: string
  actionLabel: string
  actionTo: string
}

/** Only "not yet taken" pairs — a worklist is things needing a decision,
 * not a full status report (Reports/the classroom's own เช็กชื่อ tab
 * already show everything, taken or not). */
export function attendanceToWorklistItems(items: TodayAttendanceStatus[]): WorklistItem[] {
  return items
    .filter((item) => item.status === 'not_taken')
    .map((item) => ({
      id: `attendance:${item.subjectId}:${item.classroomId}`,
      icon: CalendarCheck,
      title: `${item.subjectName} · ${item.classroomName}`,
      meta: 'ยังไม่ได้เช็กชื่อวันนี้',
      badgeLabel: 'ยังไม่ได้เช็ก',
      actionLabel: 'เช็กชื่อ',
      actionTo: buildSubjectClassroomTabPath(item.subjectId, item.classroomId, 'attendance'),
    }))
}

/** Reuses selectAssignmentsNeedingAttention verbatim — the same
 * missing/ungraded + due-date-window rule the old Assignment Action
 * Center card used, never a re-implementation. */
export function assignmentsToWorklistItems(items: AssignmentActionItem[]): WorklistItem[] {
  return selectAssignmentsNeedingAttention(items).map((item) => ({
    id: `assignment:${item.assignmentId}`,
    icon: ClipboardList,
    title: item.title,
    meta: `${item.subjectName} · ${item.classroomName}`,
    badgeLabel: item.missingCount > 0 ? `ค้าง ${item.missingCount} คน` : `ยังไม่ให้คะแนน ${item.ungradedCount} คน`,
    actionLabel: item.missingCount === 0 && item.ungradedCount > 0 ? 'ให้คะแนน' : 'ดูงาน',
    actionTo: buildAssignmentDetailPath(item.subjectId, item.classroomId, item.assignmentId),
  }))
}

export function followUpToWorklistItems(rows: FollowUpRow[]): WorklistItem[] {
  return rows.map((row) => ({
    id: `followup:${row.studentId}:${row.classroomId}`,
    icon: Users,
    title: `${row.firstName} ${row.lastName}`,
    meta: row.classroomName,
    badgeLabel: row.reasons[0]?.shortLabel ?? 'ควรติดตาม',
    actionLabel: 'ดูนักเรียน',
    actionTo: buildClassroomTabPath(row.classroomId, 'students'),
  }))
}
