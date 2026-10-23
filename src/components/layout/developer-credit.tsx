import { cn } from '@/lib/utils'

/** "Developed by Pakanan Modbut © 2026 Class N" — shared by the role choice
 * page ("/") and the student login page. Callers position it. */
export function DeveloperCredit({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs leading-relaxed text-slate-400', className)}>
      <span className="block">Developed by</span>
      <span className="block font-medium text-slate-500">Pakanan Modbut</span>
      <span className="block">© 2026 Class N</span>
    </p>
  )
}
