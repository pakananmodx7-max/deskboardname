import { LogOut, Menu, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { SemesterSelect } from '@/features/semester/semester-select'
import { useDemoClassroom } from '@/demo/demo-context'
import { DemoTeacherNotificationBell, TeacherNotificationBell } from '@/features/notifications/notification-bells'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { toFriendlyErrorMessage } from '@/lib/errors'

interface HeaderProps {
  onOpenMobileMenu: () => void
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  if (dataMode === 'supabase') {
    return <RealHeader onOpenMobileMenu={onOpenMobileMenu} />
  }
  return <DemoHeader onOpenMobileMenu={onOpenMobileMenu} />
}

function MenuButton({ onOpenMobileMenu }: HeaderProps) {
  return (
    <button
      type="button"
      onClick={onOpenMobileMenu}
      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
      aria-label="เปิดเมนู"
    >
      <Menu className="size-5" />
    </button>
  )
}

/**
 * A real, styled search field — kept purely presentational for now
 * because no cross-entity (student/classroom/subject/assignment) search
 * index exists anywhere in this codebase yet. It intentionally does not
 * submit to a fabricated endpoint; wiring it up is future work once such
 * an index exists, so it never silently no-ops on a real query a teacher
 * expects to work.
 */
function GlobalSearchField() {
  const [value, setValue] = useState('')
  return (
    <div className="relative hidden w-full max-w-sm md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ค้นหานักเรียน ห้องเรียน รายวิชา หรืองาน..."
        aria-label="ค้นหา"
        className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
    </div>
  )
}

function DemoHeader({ onOpenMobileMenu }: HeaderProps) {
  const { classroomName, resetDemo } = useDemoClassroom()
  const { toast } = useToast()

  function handleReset() {
    resetDemo()
    toast('รีเซ็ตข้อมูลเดโมเรียบร้อยแล้ว')
  }

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 max-sm:gap-1 max-sm:px-2.5 sm:px-6">
      <MenuButton onOpenMobileMenu={onOpenMobileMenu} />

      <div className="flex flex-1 items-center gap-3 max-sm:min-w-0 max-sm:gap-2 sm:gap-4">
        <div className="hidden shrink-0 leading-tight lg:block">
          <h1 className="text-base font-bold tracking-tight">KrunameClass</h1>
          <p className="text-[12px] leading-tight text-muted-foreground">ระบบจัดการห้องเรียน</p>
        </div>

        <div className="hidden h-6 w-px bg-border lg:block" />

        <NativeSelect value={classroomName} className="w-auto min-w-24" aria-label="เลือกห้องเรียน" disabled>
          <option value={classroomName}>{classroomName}</option>
        </NativeSelect>

        <SemesterSelect className="hidden sm:flex" />

        <span className="hidden shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary sm:block">
          โหมดสาธิต (Demo)
        </span>
      </div>

      <button
        type="button"
        onClick={handleReset}
        className="hidden items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex"
        title="รีเซ็ตข้อมูลเดโมทั้งหมด"
      >
        <RotateCcw className="size-3.5" />
        รีเซ็ตข้อมูลเดโม
      </button>

      <button
        type="button"
        onClick={handleReset}
        className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent sm:hidden"
        aria-label="รีเซ็ตข้อมูลเดโม"
      >
        <RotateCcw className="size-5" />
      </button>

      <ThemeToggle />
      <DemoTeacherNotificationBell />

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

function RealHeader({ onOpenMobileMenu }: HeaderProps) {
  const { profile, signOut } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const displayName = profile?.displayName?.trim() || 'คุณครู'
  const initials = displayName.slice(0, 2)

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (err) {
      toast(toFriendlyErrorMessage(err))
    }
  }

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 max-sm:gap-1 max-sm:px-2.5 sm:px-6">
      <MenuButton onOpenMobileMenu={onOpenMobileMenu} />

      <div className="flex flex-1 items-center gap-3 max-sm:min-w-0 max-sm:gap-2 sm:gap-4">
        <div className="shrink-0 leading-tight max-sm:min-w-0 max-sm:shrink">
          <h1 className="text-base font-bold tracking-tight max-sm:truncate">KrunameClass</h1>
          <p className="hidden text-[12px] leading-tight text-muted-foreground sm:block">ระบบจัดการห้องเรียน</p>
        </div>

        <GlobalSearchField />
      </div>

      <SemesterSelect className="hidden sm:flex" />
      <ThemeToggle />
      <TeacherNotificationBell />

      <div className="flex items-center gap-2">
        <Avatar>{initials}</Avatar>
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">ครูผู้สอน</p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSignOut}
        className="hidden items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex"
        title="ออกจากระบบ"
      >
        <LogOut className="size-3.5" />
        ออกจากระบบ
      </button>

      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent sm:hidden"
        aria-label="ออกจากระบบ"
      >
        <LogOut className="size-5" />
      </button>
    </header>
  )
}
