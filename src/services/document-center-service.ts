import { toDocumentItem, type DocumentItem, type DocumentSource, type ResourceRowInput } from '@/features/document-center/document-center-model'
import { downloadBlob } from '@/lib/export/download-blob'
import { getSupabaseClient } from '@/lib/supabase'
import { getResourceSignedUrl } from '@/services/assignment-resource-service'
import { fetchAllPages, withTimeout } from '@/services/classroom-analytics-service'
import { getLessonResourceSignedUrl } from '@/services/lesson-service'
import { isMissingOptionalColumnError, isOptionalTableMissingError } from '@/services/student-portal-service'

/**
 * Document Center (Phase 1) — read-only view over the teacher's existing
 * files and links: assignment_resources (0013) and lesson_resources
 * (0015), with drive_file_id from 0018. Both tables are already
 * RLS-scoped to the owning teacher (is_teacher_of_assignment /
 * is_teacher_of_lesson), so this only ever returns that teacher's own
 * rows. Nothing here writes; files keep being managed where they were
 * attached (the assignment or the lesson).
 */

interface ParentRow {
  id: string
  title: string
  subject_id: string | null
  classroom_id: string | null
  subjects: { name: string } | null
  classrooms: { name: string; academic_year: string | null; semester: string | null } | null
}

interface ResourceRow {
  id: string
  title: string
  file_path: string | null
  url: string | null
  mime_type: string | null
  drive_file_id?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  assignments?: ParentRow | null
  lessons?: ParentRow | null
}

const BASE_COLUMNS = 'id, title, file_path, url, mime_type, created_by, created_at, updated_at'
const PARENT = (table: 'assignments' | 'lessons') => `${table}!inner(id, title, subject_id, classroom_id, subjects(name), classrooms(name, academic_year, semester))`

async function loadSource(source: DocumentSource): Promise<DocumentItem[]> {
  const supabase = getSupabaseClient()
  const table = source === 'assignment' ? 'assignment_resources' : 'lesson_resources'
  const parent = source === 'assignment' ? 'assignments' : 'lessons'
  const query = (columns: string) =>
    fetchAllPages<ResourceRow>((from, to) =>
      supabase
        .from(table)
        .select(`${columns}, ${PARENT(parent)}`)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: ResourceRow[] | null; error: unknown }>,
    )

  let rows: ResourceRow[]
  try {
    rows = await query(`${BASE_COLUMNS}, drive_file_id`)
  } catch (err) {
    if (isOptionalTableMissingError(err)) return [] // 0013 / 0015 not applied
    if (!isMissingOptionalColumnError(err)) throw err
    rows = await query(BASE_COLUMNS) // 0018 not applied: no drive_file_id yet
  }

  return rows.flatMap((row) => {
    const p = source === 'assignment' ? row.assignments : row.lessons
    if (!p) return []
    const input: ResourceRowInput = {
      source,
      id: row.id,
      title: row.title,
      filePath: row.file_path,
      url: row.url,
      mimeType: row.mime_type,
      driveFileId: row.drive_file_id ?? null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      parent: {
        id: p.id,
        title: p.title,
        subjectId: p.subject_id,
        subjectName: p.subjects?.name ?? null,
        classroomId: p.classroom_id,
        classroomName: p.classrooms?.name ?? null,
        academicYear: p.classrooms?.academic_year ?? null,
        semester: p.classrooms?.semester ?? null,
      },
    }
    return [toDocumentItem(input)]
  })
}

/** Every file/link the signed-in teacher has attached to an assignment or
 * a lesson. Two paged queries, timeout-protected. */
export async function listTeacherDocuments(): Promise<DocumentItem[]> {
  const [assignmentDocs, lessonDocs] = await withTimeout(Promise.all([loadSource('assignment'), loadSource('lesson')]))
  return [...assignmentDocs, ...lessonDocs]
}

/** Short-lived signed URL for a stored file (private buckets), through the
 * same helpers the assignment and lesson pages use. */
export function getDocumentFileUrl(item: DocumentItem): Promise<string> {
  if (!item.filePath) return Promise.reject(new Error('เอกสารนี้ไม่มีไฟล์ให้เปิด'))
  return item.source === 'assignment' ? getResourceSignedUrl(item.filePath) : getLessonResourceSignedUrl(item.filePath)
}

/** Downloads a stored file under its document name. Links have no file. */
export async function downloadDocumentFile(item: DocumentItem, fileName: string): Promise<void> {
  const url = await getDocumentFileUrl(item)
  const response = await fetch(url)
  if (!response.ok) throw new Error('ดาวน์โหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่')
  downloadBlob(await response.blob(), fileName)
}
