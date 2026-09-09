import { getSupabaseClient } from '@/lib/supabase'

/**
 * Sends one individual teacher -> student notification. This is the ONE
 * mutation implementation for "ส่งข้อความ" — both teacher UI entry points
 * (the Students page's row action and the Subject -> Classroom ->
 * นักเรียน drawer) call this exact function, never a duplicate insert.
 *
 * teacherId must be the caller's own profiles.id (auth.uid()) — the
 * RLS policy teacher_student_notifications_insert_own_student (0012)
 * independently re-checks this via `teacher_id = auth.uid()`, so passing
 * anything else here simply fails, it never grants anything. studentId
 * is the recipient; the same policy's is_teacher_of_student() check is
 * what actually enforces "only a student in one of this teacher's own
 * classrooms" — this function does not (and must not) re-implement that
 * check client-side, since the server-side check is the real boundary.
 *
 * Classroom/bulk broadcast is explicitly out of scope for this phase —
 * see the studentIds-less signature; a future bulk variant would call
 * this same insert shape in a loop or a dedicated RPC, not duplicate it.
 */
export async function sendStudentNotification(
  studentId: string,
  teacherId: string,
  message: string,
  title?: string | null,
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('teacher_student_notifications').insert({
    student_id: studentId,
    teacher_id: teacherId,
    title: title?.trim() ? title.trim() : null,
    message,
  })
  if (error) throw error
}
