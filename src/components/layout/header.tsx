import { Bell, Menu } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { NativeSelect } from '@/components/ui/select'
import { isSupabaseConfigured } from '@/lib/supabase'
import { getClassrooms } from '@/services/classroom-service'
import type { Classroom } from '@/types/classroom'

interface HeaderProps {
  onOpenMobileMenu: () => void
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroomId, setSelectedClassroomId] = useState('')

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let active = true
    getClassrooms()
      .then((result) => {
        if (!active) return
        setClassrooms(result)
        setSelectedClassroomId((current) => current || (result[0]?.id ?? ''))
      })
      .catch(() => {
        // Header is shown on every page; failures here are non-critical,
        // so we quietly fall back to the disabled placeholder below.
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex flex-1 items-center gap-3 sm:gap-4">
        <h1 className="hidden shrink-0 text-base font-semibold tracking-tight sm:block">
          AI Classroom
        </h1>

        <div className="hidden h-6 w-px bg-border sm:block" />

        {classrooms.length > 0 ? (
          <NativeSelect
            value={selectedClassroomId}
            onChange={(e) => setSelectedClassroomId(e.target.value)}
            className="w-auto min-w-24"
            aria-label="เลือกห้องเรียน"
          >
            {classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {classroom.name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <NativeSelect className="w-auto min-w-24" aria-label="เลือกห้องเรียน" disabled>
            <option>ยังไม่มีห้องเรียน</option>
          </NativeSelect>
        )}

        <span className="hidden truncate text-sm text-muted-foreground md:block">
          ภาคเรียนที่ 1 / 2569
        </span>
      </div>

      <button
        type="button"
        className="relative rounded-md p-2 text-muted-foreground hover:bg-accent"
        aria-label="การแจ้งเตือน"
      >
        <Bell className="size-5" />
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
      </button>

      <div className="flex items-center gap-2">
        <Avatar>คส</Avatar>
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-medium">คุณครูสมศรี</p>
          <p className="text-xs text-muted-foreground">ครูประจำชั้น</p>
        </div>
      </div>
    </header>
  )
}
