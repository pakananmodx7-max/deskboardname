import { cn } from '@/lib/utils'

/** "Developed by Pakanan Modbut © 2026 Class N" — shared by the role choice
 * page ("/"), the login pages and the startup splash. Callers position it;
 * `tone="navy"` is the splash's darker variant (bold name). */
export function DeveloperCredit({ className, tone = 'muted' }: { className?: string; tone?: 'muted' | 'navy' }) {
  const navy = tone === 'navy'
  return (
    <p className={cn('text-xs leading-relaxed', navy ? 'text-[#2b3d78]' : 'text-slate-400', className)}>
      <span className="block">Developed by</span>
      <span className={cn('block', navy ? 'font-bold text-[#14245c]' : 'font-medium text-slate-500')}>Pakanan Modbut</span>
      <span className="block">© 2026 Class N</span>
    </p>
  )
}
