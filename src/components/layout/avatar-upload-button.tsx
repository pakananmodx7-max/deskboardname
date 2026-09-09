import { Camera, Loader2 } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'

import { StudentAvatar } from '@/components/layout/student-avatar'
import { useToast } from '@/components/ui/toast'
import { removeMyAvatar, uploadMyAvatar } from '@/services/student-portal-service'
import { cn } from '@/lib/utils'

interface AvatarUploadButtonProps {
  avatarPath: string | null
  firstName: string
  onChanged: (newAvatarPath: string | null) => void
  className?: string
}

/**
 * The one editable avatar control in the student portal (see Section B —
 * an approved student may set/change ONLY their own avatar). Everywhere
 * else an avatar is shown (sidebar identity block) it's the read-only
 * StudentAvatar. Upload always writes to '<own student id>/avatar.<ext>'
 * (see uploadMyAvatar) — there is no way to type/choose a different
 * path from this UI.
 */
export function AvatarUploadButton({ avatarPath, firstName, onChanged, className }: AvatarUploadButtonProps) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBusy(true)
    try {
      const newPath = await uploadMyAvatar(file)
      onChanged(newPath)
      toast('อัปเดตรูปโปรไฟล์แล้ว')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'ไม่สามารถอัปโหลดรูปโปรไฟล์ได้', 'info')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await removeMyAvatar(avatarPath)
      onChanged(null)
      toast('ลบรูปโปรไฟล์แล้ว')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'ไม่สามารถลบรูปโปรไฟล์ได้', 'info')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="เปลี่ยนรูปโปรไฟล์"
      >
        <StudentAvatar avatarPath={avatarPath} firstName={firstName} className="size-10" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/40">
          {busy ? (
            <Loader2 className="size-4 animate-spin text-white" />
          ) : (
            <Camera className="size-3.5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      </button>
      {avatarPath && !busy && (
        <button
          type="button"
          onClick={handleRemove}
          className="mt-0.5 block w-full text-center text-[10px] text-muted-foreground hover:text-destructive hover:underline"
        >
          ลบรูป
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  )
}
