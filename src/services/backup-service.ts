import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/attendance-status'
import { buildCsvContent, type ExportTable } from '@/lib/export/export-table'
import { getSupabaseClient } from '@/lib/supabase'
import { getAllAttendanceForClassroom } from '@/services/attendance-service'
import { getAssignments, getSubmissions } from '@/services/assignment-service'
import { getAssignmentResources } from '@/services/assignment-resource-service'
import { getClassrooms } from '@/services/classroom-service'
import { getLessonResources, getLessons } from '@/services/lesson-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getSubjectClassrooms, getSubjects } from '@/services/subject-service'
import { getSubmissionResources } from '@/services/submission-service'
import type { AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { ClassroomStudent } from '@/types/student'

/**
 * Teacher Data Backup Export ("Settings → สำรองข้อมูล").
 *
 * SCOPE: every function this module calls is an EXISTING, already-RLS-scoped
 * read from assignment-service.ts / attendance-service.ts / classroom-service.ts /
 * lesson-service.ts / student-service.ts / subject-service.ts /
 * submission-service.ts / assignment-resource-service.ts — nothing here
 * writes a new Supabase query shape or grants any new access. Every one
 * of those functions already scopes strictly to "rows the calling
 * teacher owns" (classrooms.teacher_id = auth.uid(), or transitively
 * through it) — the SAME RLS policies verified across every migration
 * from 0001 through 0016. This module cannot see, and therefore cannot
 * export, another teacher's data: cross-teacher isolation is INHERITED,
 * never re-implemented here.
 *
 * ZIP LAYOUT — two parallel sections, built from the exact same fetched
 * data (one pass, no second round of Supabase calls):
 *
 *   - `raw/*.csv` — the untouched technical tables (UUIDs, foreign keys,
 *     enum values), unchanged from the original backup format. This is
 *     what a future restore/import feature would read. No table here
 *     duplicates a name/label from another table — assignment_submissions
 *     still carries only student_id, never a joined name.
 *   - `readable/*.csv` — derived, human-readable views built by JOINING
 *     the same already-fetched rows in memory (classroom/subject/student
 *     names resolved, statuses translated to Thai) so a teacher can open
 *     the file directly and understand it without cross-referencing
 *     UUIDs. These are report-shaped, one-way exports — never read back
 *     by any restore path.
 *   - `backup_info.csv` — one manifest at the ZIP root covering both
 *     sections.
 *
 * CONTENT: raw academic records only — classrooms, students, classroom
 * memberships, subjects, subject-classroom links, assignments, assignment
 * submissions (status/score/note/timestamps), assignment resource
 * METADATA, attendance sessions, attendance records, lessons, lesson
 * resource METADATA, and submission resource METADATA. "Metadata" for any
 * file/link resource means exactly: title, resource type, a stable
 * storage path IDENTIFIER (never a signed URL — see the note on
 * signedUrl functions below), external URL, and the id of whichever
 * assignment/lesson/submission it belongs to. No binary file content is
 * ever read or included in this version — see the feature spec's Section
 * 3 ("Do NOT include binary uploaded files in the first backup version").
 *
 * SIGNED URLS: this module deliberately never imports
 * getResourceSignedUrl / getLessonResourceSignedUrl /
 * getSubmissionResourceSignedUrl from any service — a signed URL is a
 * short-lived credential (expires in minutes), never a valid backup
 * identifier. Only the permanent storage PATH (or the resource's own
 * external_url for a link) is ever written to a CSV row.
 */

const BACKUP_SCHEMA_VERSION = '2'
/** The last migration whose tables this backup format accounts for —
 * bump this alongside the export whenever a future migration adds/
 * changes a table this module reads from, so an old backup file's
 * schema_version is still meaningful evidence of what shape to expect. */
const LATEST_ACCOUNTED_MIGRATION = '0016_assignment_submission_uploads'

const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: 'ส่งแล้ว',
  not_submitted: 'ยังไม่ส่ง',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

const STUDENT_ACTIVE_LABEL = 'กำลังเรียน'
const STUDENT_INACTIVE_LABEL = 'ไม่ได้ใช้งาน'
const ASSIGNMENT_ARCHIVED_LABEL = 'เก็บถาวร'
const ASSIGNMENT_ACTIVE_LABEL = 'ใช้งานอยู่'

export interface BackupCsvFile {
  /** File name inside the ZIP — e.g. "raw/classrooms.csv" or
   * "readable/grades.csv". May contain a `/` to place the file under the
   * `raw/`/`readable/` folder (JSZip creates the folder entry
   * automatically); every path segment here is a hardcoded literal
   * this module controls, never derived from any teacher-entered value,
   * so there is no traversal risk despite the `/`. */
  filename: string
  content: string
}

export interface TeacherBackup {
  files: BackupCsvFile[]
  generatedAt: string
  teacherEmail: string | null
}

function csvFile(name: string, table: ExportTable): BackupCsvFile {
  return { filename: `${name}.csv`, content: buildCsvContent(table) }
}

async function requireTeacherIdentity(): Promise<{ id: string; email: string | null }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  }
  return { id: data.user.id, email: data.user.email ?? null }
}

/** Pure — builds the manifest table from already-known values. Exported
 * for the export flow; also directly unit-testable without Supabase. */
export function buildManifestTable(generatedAt: string, teacherEmail: string | null, rowCounts: Record<string, number>): ExportTable {
  const rows: (string | number)[][] = [
    ['generated_at', generatedAt],
    ['teacher_email', teacherEmail ?? ''],
    ['backup_schema_version', BACKUP_SCHEMA_VERSION],
    ['latest_accounted_migration', LATEST_ACCOUNTED_MIGRATION],
    ...Object.entries(rowCounts).map(([table, count]) => [`rows_${table}`, count] as [string, number]),
  ]
  return {
    title: 'ข้อมูลสำรอง',
    subtitle: 'สร้างโดยระบบ AI Classroom Management',
    headers: ['field', 'value'],
    rows,
  }
}

export interface ReadableRosterItem {
  classroomName: string
  number: number | null
  studentCode: string | null
  firstName: string
  lastName: string
  statusLabel: string
}

/** Pure — the required readable-roster ordering: classroom name, then
 * student number/order, with unnumbered students sorted after numbered
 * ones within the same classroom (never crashes on a null number).
 * Exported so the ordering rule itself is directly unit-testable without
 * a Supabase fetch. */
export function sortReadableRoster(items: ReadableRosterItem[]): ReadableRosterItem[] {
  return [...items].sort(
    (a, b) =>
      a.classroomName.localeCompare(b.classroomName, 'th') || (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * Fetches every table this backup covers and returns them as CSV files
 * ready to zip: the untouched `raw/*.csv` tables plus a `readable/*.csv`
 * section joined from the exact same in-memory rows. Sequential/fanned-out
 * reads only — this is a manual, occasional teacher action (not a hot
 * render path), so favoring simplicity and reuse of existing per-entity
 * service calls over a hand-rolled bulk query is the right tradeoff here;
 * independent per-classroom/per-subject fetches run in parallel via
 * Promise.all.
 */
export async function buildTeacherBackup(): Promise<TeacherBackup> {
  const teacher = await requireTeacherIdentity()
  const generatedAt = new Date().toISOString()

  const [classrooms, subjects] = await Promise.all([getClassrooms(), getSubjects()])
  const classroomNameById = new Map(classrooms.map((c) => [c.id, c.name]))
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]))

  const classroomRows = classrooms.map((c) => [
    c.id,
    c.name,
    c.gradeLevel ?? '',
    c.section ?? '',
    c.academicYear ?? '',
    c.semester ?? '',
    c.isActive ? 'active' : 'archived',
    c.createdAt,
    c.updatedAt,
  ])

  const studentsById = new Map<string, ClassroomStudent>()
  const membershipRows: (string | number)[][] = []
  const attendanceSessionRows: (string | number)[][] = []
  const attendanceRecordRows: (string | number)[][] = []
  const readableRosterItems: ReadableRosterItem[] = []
  const readableAttendanceRows: (string | number)[][] = []

  await Promise.all(
    classrooms.map(async (c) => {
      const [students, attendance] = await Promise.all([getStudentsByClassroom(c.id), getAllAttendanceForClassroom(c.id)])
      const studentsInClassroomById = new Map(students.map((s) => [s.id, s]))
      const sessionById = new Map(attendance.sessions.map((session) => [session.id, session]))

      for (const s of students) {
        studentsById.set(s.id, s)
        membershipRows.push([s.id, c.id, c.name, s.status, s.joinedAt])
        readableRosterItems.push({
          classroomName: c.name,
          number: s.number,
          studentCode: s.studentCode,
          firstName: s.firstName,
          lastName: s.lastName,
          statusLabel: s.status === 'active' ? STUDENT_ACTIVE_LABEL : STUDENT_INACTIVE_LABEL,
        })
      }

      for (const session of attendance.sessions) {
        attendanceSessionRows.push([
          session.id,
          session.classroomId,
          c.name,
          session.subjectId ?? '',
          session.periodNumber ?? '',
          session.attendanceDate,
          session.createdAt,
          session.updatedAt,
        ])
      }
      for (const record of attendance.records) {
        attendanceRecordRows.push([record.sessionId, record.studentId, record.status, record.note ?? ''])

        const session = sessionById.get(record.sessionId)
        const student = studentsInClassroomById.get(record.studentId)
        readableAttendanceRows.push([
          session?.attendanceDate ?? '',
          c.name,
          session?.subjectId ? (subjectNameById.get(session.subjectId) ?? '-') : '',
          student?.number ?? '',
          student?.studentCode ?? '',
          student?.firstName ?? '-',
          student?.lastName ?? '',
          ATTENDANCE_STATUS_LABEL[record.status],
          record.note ?? '',
        ])
      }
    }),
  )

  const subjectRows = subjects.map((s) => [
    s.id,
    s.name,
    s.subjectCode ?? '',
    s.description ?? '',
    s.academicYear ?? '',
    s.semester ?? '',
    s.isActive ? 'active' : 'archived',
    s.createdAt,
    s.updatedAt,
  ])

  const linkRows: (string | number)[][] = []
  const assignmentRows: (string | number)[][] = []
  const submissionRows: (string | number)[][] = []
  const assignmentResourceRows: (string | number)[][] = []
  const submissionResourceRows: (string | number)[][] = []
  const lessonRows: (string | number)[][] = []
  const lessonResourceRows: (string | number)[][] = []
  const readableAssignmentRows: (string | number)[][] = []
  const readableGradeRows: (string | number)[][] = []

  await Promise.all(
    subjects.map(async (subject) => {
      const links = await getSubjectClassrooms(subject.id)

      await Promise.all(
        links.map(async (link) => {
          linkRows.push([link.id, subject.id, subject.name, link.classroomId, link.classroomName ?? ''])
          const classroomName = classroomNameById.get(link.classroomId) ?? link.classroomName ?? '-'

          const [assignments, lessons] = await Promise.all([
            getAssignments(subject.id, link.classroomId),
            getLessons(subject.id, link.classroomId),
          ])

          await Promise.all(
            assignments.map(async (a) => {
              assignmentRows.push([
                a.id,
                subject.id,
                link.classroomId,
                a.title,
                a.description ?? '',
                a.maxScore,
                a.dueDate ?? '',
                a.isArchived ? 'archived' : 'active',
                a.createdAt,
                a.updatedAt,
              ])
              readableAssignmentRows.push([
                subject.name,
                classroomName,
                a.title,
                a.description ?? '',
                a.dueDate ?? '',
                a.maxScore,
                a.isArchived ? ASSIGNMENT_ARCHIVED_LABEL : ASSIGNMENT_ACTIVE_LABEL,
              ])

              const [submissions, resources] = await Promise.all([getSubmissions(a.id), getAssignmentResources(a.id)])

              for (const resource of resources) {
                assignmentResourceRows.push([
                  resource.id,
                  a.id,
                  resource.resourceType,
                  resource.title,
                  resource.filePath ?? '',
                  resource.url ?? '',
                  resource.createdAt,
                ])
              }

              const submissionEntries = Object.entries(submissions) as [string, AssignmentSubmission][]
              for (const [studentId, submission] of submissionEntries) {
                submissionRows.push([
                  submission.id ?? '',
                  a.id,
                  studentId,
                  submission.status,
                  submission.score ?? '',
                  submission.note ?? '',
                  submission.submittedAt ?? '',
                  submission.reviewedAt ?? '',
                ])

                // Joined for readable/grades.csv only — the raw
                // assignment_submissions row above never gains a name
                // column, this is a separate derived view built purely
                // from the already-fetched roster map, not a schema change.
                const student = studentsById.get(studentId)
                readableGradeRows.push([
                  classroomName,
                  student?.number ?? '',
                  student?.studentCode ?? '',
                  student?.firstName ?? '-',
                  student?.lastName ?? '',
                  subject.name,
                  a.title,
                  SUBMISSION_STATUS_LABEL[submission.status],
                  submission.score ?? '',
                  a.maxScore,
                  submission.submittedAt ?? '',
                  submission.note ?? '',
                ])

                if (submission.id) {
                  const subResources = await getSubmissionResources(submission.id)
                  for (const resource of subResources) {
                    submissionResourceRows.push([
                      resource.id,
                      submission.id,
                      a.id,
                      studentId,
                      resource.resourceType,
                      resource.title ?? '',
                      resource.storagePath ?? '',
                      resource.externalUrl ?? '',
                      resource.originalFilename ?? '',
                      resource.deletedAt ? 'cleaned_up' : 'available',
                      resource.createdAt,
                    ])
                  }
                }
              }
            }),
          )

          await Promise.all(
            lessons.map(async (lesson) => {
              lessonRows.push([
                lesson.id,
                subject.id,
                link.classroomId,
                lesson.title,
                lesson.description ?? '',
                lesson.sortOrder,
                lesson.isPublished ? 'published' : 'draft',
                lesson.isArchived ? 'archived' : 'active',
                lesson.createdAt,
                lesson.updatedAt,
              ])

              const resources = await getLessonResources(lesson.id)
              for (const resource of resources) {
                lessonResourceRows.push([
                  resource.id,
                  lesson.id,
                  resource.resourceType,
                  resource.title,
                  resource.filePath ?? '',
                  resource.url ?? '',
                  resource.createdAt,
                ])
              }
            }),
          )
        }),
      )
    }),
  )

  const students = Array.from(studentsById.values())
  const studentRows = students.map((s) => [
    s.id,
    s.studentCode ?? '',
    s.number ?? '',
    s.firstName,
    s.lastName,
    s.nickname ?? '',
    s.email ?? '',
    s.phone ?? '',
    s.status,
    s.createdAt,
  ])

  const readableRosterRows = sortReadableRoster(readableRosterItems).map((r) => [
    r.classroomName,
    r.number ?? '',
    r.studentCode ?? '',
    r.firstName,
    r.lastName,
    r.statusLabel,
  ])

  const rowCounts = {
    classrooms: classroomRows.length,
    students: studentRows.length,
    classroom_memberships: membershipRows.length,
    subjects: subjectRows.length,
    subject_classroom_links: linkRows.length,
    assignments: assignmentRows.length,
    assignment_submissions: submissionRows.length,
    assignment_resources: assignmentResourceRows.length,
    attendance_sessions: attendanceSessionRows.length,
    attendance_records: attendanceRecordRows.length,
    lessons: lessonRows.length,
    lesson_resources: lessonResourceRows.length,
    submission_resources: submissionResourceRows.length,
    readable_student_roster: readableRosterRows.length,
    readable_grades: readableGradeRows.length,
    readable_attendance: readableAttendanceRows.length,
    readable_assignments: readableAssignmentRows.length,
  }

  const files: BackupCsvFile[] = [
    csvFile('backup_info', buildManifestTable(generatedAt, teacher.email, rowCounts)),

    // --- raw/*.csv — untouched technical tables, for future restore ---
    csvFile('raw/classrooms', {
      title: 'ห้องเรียน',
      subtitle: generatedAt,
      headers: ['id', 'name', 'grade_level', 'section', 'academic_year', 'semester', 'status', 'created_at', 'updated_at'],
      rows: classroomRows,
    }),
    csvFile('raw/students', {
      title: 'นักเรียน',
      subtitle: generatedAt,
      headers: ['id', 'student_code', 'number', 'first_name', 'last_name', 'nickname', 'email', 'phone', 'status', 'created_at'],
      rows: studentRows,
    }),
    csvFile('raw/classroom_memberships', {
      title: 'สมาชิกห้องเรียน',
      subtitle: generatedAt,
      headers: ['student_id', 'classroom_id', 'classroom_name', 'membership_status', 'joined_at'],
      rows: membershipRows,
    }),
    csvFile('raw/subjects', {
      title: 'รายวิชา',
      subtitle: generatedAt,
      headers: ['id', 'name', 'subject_code', 'description', 'academic_year', 'semester', 'status', 'created_at', 'updated_at'],
      rows: subjectRows,
    }),
    csvFile('raw/subject_classroom_links', {
      title: 'การเชื่อมโยงรายวิชา-ห้องเรียน',
      subtitle: generatedAt,
      headers: ['link_id', 'subject_id', 'subject_name', 'classroom_id', 'classroom_name'],
      rows: linkRows,
    }),
    csvFile('raw/assignments', {
      title: 'งาน',
      subtitle: generatedAt,
      headers: [
        'id',
        'subject_id',
        'classroom_id',
        'title',
        'description',
        'max_score',
        'due_date',
        'status',
        'created_at',
        'updated_at',
      ],
      rows: assignmentRows,
    }),
    csvFile('raw/assignment_submissions', {
      title: 'การส่งงานและคะแนน',
      subtitle: generatedAt,
      headers: ['submission_id', 'assignment_id', 'student_id', 'status', 'score', 'note', 'submitted_at', 'reviewed_at'],
      rows: submissionRows,
    }),
    csvFile('raw/assignment_resources', {
      title: 'สื่อและใบงาน (เมทาดาทา)',
      subtitle: generatedAt,
      headers: ['id', 'assignment_id', 'resource_type', 'title', 'storage_path', 'external_url', 'created_at'],
      rows: assignmentResourceRows,
    }),
    csvFile('raw/submission_resources', {
      title: 'งานที่นักเรียนส่ง (เมทาดาทา)',
      subtitle: generatedAt,
      headers: [
        'id',
        'submission_id',
        'assignment_id',
        'student_id',
        'resource_type',
        'title',
        'storage_path',
        'external_url',
        'original_filename',
        'file_status',
        'created_at',
      ],
      rows: submissionResourceRows,
    }),
    csvFile('raw/attendance_sessions', {
      title: 'รอบเช็คชื่อ',
      subtitle: generatedAt,
      headers: ['id', 'classroom_id', 'classroom_name', 'subject_id', 'period_number', 'attendance_date', 'created_at', 'updated_at'],
      rows: attendanceSessionRows,
    }),
    csvFile('raw/attendance_records', {
      title: 'บันทึกการเช็คชื่อ',
      subtitle: generatedAt,
      headers: ['session_id', 'student_id', 'status', 'note'],
      rows: attendanceRecordRows,
    }),
    csvFile('raw/lessons', {
      title: 'บทเรียน',
      subtitle: generatedAt,
      headers: ['id', 'subject_id', 'classroom_id', 'title', 'description', 'sort_order', 'publish_status', 'status', 'created_at', 'updated_at'],
      rows: lessonRows,
    }),
    csvFile('raw/lesson_resources', {
      title: 'สื่อการสอน (เมทาดาทา)',
      subtitle: generatedAt,
      headers: ['id', 'lesson_id', 'resource_type', 'title', 'storage_path', 'external_url', 'created_at'],
      rows: lessonResourceRows,
    }),

    // --- readable/*.csv — joined, Thai-labeled, for manual inspection ---
    csvFile('readable/student_roster', {
      title: 'รายชื่อนักเรียน',
      subtitle: generatedAt,
      headers: ['ห้องเรียน', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล', 'สถานะ'],
      rows: readableRosterRows,
    }),
    csvFile('readable/grades', {
      title: 'คะแนนและการส่งงาน',
      subtitle: generatedAt,
      headers: [
        'ห้องเรียน',
        'เลขที่',
        'รหัสนักเรียน',
        'ชื่อ',
        'นามสกุล',
        'วิชา',
        'งาน',
        'สถานะการส่ง',
        'คะแนน',
        'คะแนนเต็ม',
        'วันที่ส่ง',
        'หมายเหตุ',
      ],
      rows: readableGradeRows,
    }),
    csvFile('readable/attendance', {
      title: 'การเข้าเรียน',
      subtitle: generatedAt,
      headers: ['วันที่', 'ห้องเรียน', 'วิชา', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล', 'สถานะการเข้าเรียน', 'หมายเหตุ'],
      rows: readableAttendanceRows,
    }),
    csvFile('readable/assignments', {
      title: 'งานทั้งหมด',
      subtitle: generatedAt,
      headers: ['วิชา', 'ห้องเรียน', 'ชื่องาน', 'รายละเอียด', 'กำหนดส่ง', 'คะแนนเต็ม', 'สถานะ'],
      rows: readableAssignmentRows,
    }),
  ]

  return { files, generatedAt, teacherEmail: teacher.email }
}
