import type * as React from 'react'

import { Avatar } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/services/student-portal-service'

interface StudentAvatarProps extends React.ComponentProps<typeof Avatar> {
  avatarPath: string | null
  firstName: string
}

/** Renders the uploaded avatar image when avatarPath is set, otherwise
 * falls back to initials — the one rule this app uses everywhere an
 * avatar is shown (header, sidebar, dashboard). Display-only; see
 * avatar-upload-button.tsx for the editable variant. */
export function StudentAvatar({ avatarPath, firstName, className, ...props }: StudentAvatarProps) {
  const initials = firstName.slice(0, 2)
  if (!avatarPath) {
    return (
      <Avatar className={className} {...props}>
        {initials}
      </Avatar>
    )
  }
  return (
    <Avatar className={className} {...props}>
      <img src={getAvatarUrl(avatarPath)} alt="" className="h-full w-full object-cover" />
    </Avatar>
  )
}
