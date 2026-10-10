/**
 * Build-time feature flags, read from VITE_ environment variables like
 * the rest of the app's configuration (see .env.example).
 *
 * A flag here controls only what the browser shows and attempts. Anything
 * with a security meaning is ALSO enforced in the database. The UI flag
 * is a convenience; the server-side flag is the real gate.
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on'])
const FALSE_VALUES = new Set(['false', '0', 'no', 'off'])

/** Lenient boolean parsing for env values; anything unrecognised (or
 * unset) falls back to `fallback`. */
export function parseBooleanFlag(raw: string | boolean | undefined | null, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  const value = raw?.trim().toLowerCase()
  if (value && TRUE_VALUES.has(value)) return true
  if (value && FALSE_VALUES.has(value)) return false
  return fallback
}

/**
 * Public teacher self-registration (/signup). Temporarily OFF by default.
 *
 * Set VITE_ENABLE_TEACHER_REGISTRATION=true (and rebuild/redeploy) to show
 * the teacher sign-up page and link again. The database enforces the same
 * rule independently: public.app_settings key 'enable_teacher_registration'
 * (supabase/migrations/0028_teacher_registration_flag.sql), checked by the
 * handle_new_user trigger. Both must be true for teachers to self-register.
 * Student registration (/student/signup) is not affected by either flag.
 */
export const ENABLE_TEACHER_REGISTRATION: boolean = parseBooleanFlag(import.meta.env.VITE_ENABLE_TEACHER_REGISTRATION, false)

export const TEACHER_REGISTRATION_DISABLED_MESSAGE = 'ปิดรับสมัครบัญชีครูชั่วคราว กรุณาติดต่อผู้ดูแลระบบ'

/** Thrown by signUp() for a teacher sign-up while registration is closed;
 * its (Thai) message is shown to the user as is (see errors.ts). */
export class TeacherRegistrationDisabledError extends Error {
  constructor() {
    super(TEACHER_REGISTRATION_DISABLED_MESSAGE)
    this.name = 'TeacherRegistrationDisabledError'
  }
}
