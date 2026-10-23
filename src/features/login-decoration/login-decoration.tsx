import { DeveloperCredit } from '@/components/layout/developer-credit'

import { LoginShapes } from './login-shapes'
import { LoginWaves } from './login-waves'

/**
 * Decoration shared by the teacher (/login) and student (/student/login)
 * sign-in pages. Pass LoginBackground as AuthShell's `background` (which
 * reserves the space below the form) and put LoginCredit at the end of the
 * shell's `footer`.
 */
export function LoginBackground() {
  return (
    <>
      <LoginShapes />
      <LoginWaves />
    </>
  )
}

/** Developer credit, bottom-right. Absolute against AuthShell's root
 * (relative when a background is set), inside the space reserved below the
 * form and clear of the safe areas; kept after the links in reading order. */
export function LoginCredit() {
  return (
    <DeveloperCredit className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-10 text-right" />
  )
}
