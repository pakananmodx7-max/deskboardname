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
import type { AssignmentSubmission } from '@/types/assignment'
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
 * CONTENT: raw academic records only, as CSV tables bundled into one
 * ZIP — classrooms, students, classroom memberships, subjects,
 * subject-classroom links, assignments, assignment submissions (status/
 * score/note/timestamps), assignment resource METADATA, attendance
 * sessions, attendance records, lessons, lesson resource METADATA, and
 * submission resource METADATA. "Metadata" for any file/link resource
 * means exactly: title, resource type, a stable storage path
 * IDENTIFIER (never a signed URL — see the note on signedUrl functions
 * below), external URL, and the id of whichever assignment/lesson/
 * submission it belongs to. No binary file content is ever read or
 * included in this version — see the feature spec's Section 3 ("Do NOT
 * include binary uploaded files in the first backup version").
 *
 * SIGNED URLS: this module deliberately never imports
 * getResourceSignedUrl / getLessonResourceSignedUrl /
 * getSubmissionResourceSignedUrl from any service — a signed URL is a
 * short-lived credential (expires in minutes), never a valid backup
 * identifier. Only the permanent storage PATH (or the resource's own
 * external_url for a link) is ever written to a CSV row.
 */

const BACKUP_SCHEMA_VERSION = '1'
/** The last migration whose tables this backup format accounts for —
 * bump this alongside the export whenever a future migration adds/
 * changes a table this module reads from, so an old backup file's
 * schema_version is still meaningful evidence of what shape to expect. */
const LATEST_ACCOUNTED_MIGRATION = '0016_assignment_submission_uploads'

export interface BackupCsvFile {
  /** File name inside the ZIP, e.g. "classrooms.csv" — never contains a
   * path separator, so it can never escape the ZIP's flat root. */
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

/**
 * Fetches every table this backup covers and returns them as CSV files
 * ready to zip, plus the manifest. Sequential/fanned-out reads only —
 * this is a manual, occasional teacher action (not a hot render path),
 * so favoring simplicity and reuse of existing per-entity service calls
 * over a hand-rolled bulk query is the right tradeoff here; independent
 * per-classroom/per-subject fetches run in parallel via Promise.all.
 */
export async function buildTeacherBackup(): Promise<TeacherBackup> {
  const teacher = await requireTeacherIdentity()
  const generatedAt = new Date().toISOString()

  const [classrooms, subjects] = await Promise.all([getClassrooms(), getSubjects()])

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

  await Promise.all(
    classrooms.map(async (c) => {
      const [students, attendance] = await Promise.all([getStudentsByClassroom(c.id), getAllAttendanceForClassroom(c.id)])

      for (const s of students) {
        studentsById.set(s.id, s)
        membershipRows.push([s.id, c.id, c.name, s.status, s.joinedAt])
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

  await Promise.all(
    subjects.map(async (subject) => {
      const links = await getSubjectClassrooms(subject.id)

      await Promise.all(
        links.map(async (link) => {
          linkRows.push([link.id, subject.id, subject.name, link.classroomId, link.classroomName ?? ''])

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
  }

  const files: BackupCsvFile[] = [
    csvFile('backup_info', buildManifestTable(generatedAt, teacher.email, rowCounts)),
    csvFile('classrooms', {
      title: 'ห้องเรียน',
      subtitle: generatedAt,
      headers: ['id', 'name', 'grade_level', 'section', 'academic_year', 'semester', 'status', 'created_at', 'updated_at'],
      rows: classroomRows,
    }),
    csvFile('students', {
      title: 'นักเรียน',
      subtitle: generatedAt,
      headers: ['id', 'student_code', 'number', 'first_name', 'last_name', 'nickname', 'email', 'phone', 'status', 'created_at'],
      rows: studentRows,
    }),
    csvFile('classroom_memberships', {
      title: 'สมาชิกห้องเรียน',
      subtitle: generatedAt,
      headers: ['student_id', 'classroom_id', 'classroom_name', 'membership_status', 'joined_at'],
      rows: membershipRows,
    }),
    csvFile('subjects', {
      title: 'รายวิชา',
      subtitle: generatedAt,
      headers: ['id', 'name', 'subject_code', 'description', 'academic_year', 'semester', 'status', 'created_at', 'updated_at'],
      rows: subjectRows,
    }),
    csvFile('subject_classroom_links', {
      title: 'การเชื่อมโยงรายวิชา-ห้องเรียน',
      subtitle: generatedAt,
      headers: ['link_id', 'subject_id', 'subject_name', 'classroom_id', 'classroom_name'],
      rows: linkRows,
    }),
    csvFile('assignments', {
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
    csvFile('assignment_submissions', {
      title: 'การส่งงานและคะแนน',
      subtitle: generatedAt,
      headers: ['submission_id', 'assignment_id', 'student_id', 'status', 'score', 'note', 'submitted_at', 'reviewed_at'],
      rows: submissionRows,
    }),
    csvFile('assignment_resources', {
      title: 'สื่อและใบงาน (เมทาดาทา)',
      subtitle: generatedAt,
      headers: ['id', 'assignment_id', 'resource_type', 'title', 'storage_path', 'external_url', 'created_at'],
      rows: assignmentResourceRows,
    }),
    csvFile('submission_resources', {
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
    csvFile('attendance_sessions', {
      title: 'รอบเช็คชื่อ',
      subtitle: generatedAt,
      headers: ['id', 'classroom_id', 'classroom_name', 'subject_id', 'period_number', 'attendance_date', 'created_at', 'updated_at'],
      rows: attendanceSessionRows,
    }),
    csvFile('attendance_records', {
      title: 'บันทึกการเช็คชื่อ',
      subtitle: generatedAt,
      headers: ['session_id', 'student_id', 'status', 'note'],
      rows: attendanceRecordRows,
    }),
    csvFile('lessons', {
      title: 'บทเรียน',
      subtitle: generatedAt,
      headers: ['id', 'subject_id', 'classroom_id', 'title', 'description', 'sort_order', 'publish_status', 'status', 'created_at', 'updated_at'],
      rows: lessonRows,
    }),
    csvFile('lesson_resources', {
      title: 'สื่อการสอน (เมทาดาทา)',
      subtitle: generatedAt,
      headers: ['id', 'lesson_id', 'resource_type', 'title', 'storage_path', 'external_url', 'created_at'],
      rows: lessonResourceRows,
    }),
  ]

  return { files, generatedAt, teacherEmail: teacher.email }
}
