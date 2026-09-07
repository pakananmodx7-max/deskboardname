import { Bell, Menu, RotateCcw } from 'lucide-react'

import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'

interface HeaderProps {
  onOpenMobileMenu: () => void
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  const { classroomName, resetDemo } = useDemoClassroom()
  const { toast } = useToast()

  function handleReset() {
    resetDemo()
    toast('รีเซ็ตข้อมูลเดโมเรียบร้อยแล้ว')
  }

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex flex-1 items-center gap-3 sm:gap-4">
        <h1 className="hidden shrink-0 text-base font-semibold tracking-tight lg:block">
          AI Classroom
        </h1>

        <div className="hidden h-6 w-px bg-border lg:block" />

        <NativeSelect value={classroomName} className="w-auto min-w-24" aria-label="เลือกห้องเรียน" disabled>
          <option value={classroomName}>{classroomName}</option>
        </NativeSelect>

        <span className="hidden truncate text-sm text-muted-foreground md:block">
          ภาคเรียนที่ 1 / 2569
        </span>

        <span className="hidden shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary sm:block">
          โหมดสาธิต (Demo)
        </span>
      </div>

      <button
        type="button"
        onClick={handleReset}
        className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:flex"
        title="รีเซ็ตข้อมูลเดโมทั้งหมด"
      >
        <RotateCcw className="size-3.5" />
        รีเซ็ตข้อมูลเดโม
      </button>

      <button
        type="button"
        onClick={handleReset}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent sm:hidden"
        aria-label="รีเซ็ตข้อมูลเดโม"
      >
        <RotateCcw className="size-5" />
      </button>

      <ThemeToggle />

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
