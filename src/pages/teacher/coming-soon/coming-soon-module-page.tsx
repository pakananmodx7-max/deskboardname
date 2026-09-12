import type { LucideIcon } from 'lucide-react'

interface ComingSoonModulePageProps {
  icon: LucideIcon
  title: string
  description: string
  /** Small chip under the title, e.g. "เร็ว ๆ นี้" — omit for a module
   * that's real but has nothing to configure yet (see AddModulePage). */
  badge?: string
}

/**
 * Generic placeholder for a not-yet-built "ระบบของฉัน" module (Requirement
 * 1: new systems must fit into the sidebar without needing new backend
 * work for every one). Deliberately static/no data-fetching — building a
 * real system here for ระบบเอกสาร/งานและเตือนความจำ was explicitly out of
 * scope for this IA task (see the task's own "avoid introducing a major
 * new backend system" constraint).
 */
export function ComingSoonModulePage({ icon: Icon, title, description, badge }: ComingSoonModulePageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {badge && (
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{badge}</span>
      )}
    </div>
  )
}
