import { ArrowRight, GraduationCap, School, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/**
 * Public landing page at "/" for a signed-out visitor — the entry point
 * that lets a person self-identify as a teacher or a student before any
 * login form appears. Purely presentational; RootPage decides whether to
 * render this at all (an authenticated session skips straight past it).
 *
 * Branded "Class N". A fixed light design (it does not follow the app's
 * dark theme); the moving background, the heading gradient and the card
 * lift are CSS-only (.kc-role-* in index.css) and stop entirely under
 * prefers-reduced-motion. Decoration never takes pointer events.
 */
export function RoleChoicePage() {
  return (
    <div className="kc-role-page relative isolate flex min-h-[100dvh] flex-col overflow-x-clip">
      <RoleBackdrop />

      <main
        className={cn(
          'relative z-10 flex flex-1 flex-col items-center justify-center',
          'pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
          'pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))]',
        )}
      >
        <div className="w-full max-w-[66rem] text-center">
          <h1 className="kc-role-title inline-block pb-2 text-6xl font-extrabold leading-tight tracking-tight sm:text-7xl md:text-8xl">Class N</h1>
          <p className="mt-3 text-base text-slate-500 sm:text-lg">กรุณาเลือกประเภทผู้ใช้งานเพื่อเข้าสู่ระบบ</p>

          <div className="mx-auto mt-10 grid max-w-[66rem] gap-5 sm:mt-14 md:grid-cols-2 md:gap-7">
            <RoleCard
              to="/login"
              title="ครูผู้สอน"
              subtitle="เข้าสู่ระบบสำหรับครูผู้สอน"
              icon={School}
              tone="blue"
            />
            <RoleCard
              to="/student/login"
              title="นักเรียน"
              subtitle="เข้าสู่ระบบสำหรับนักเรียน"
              icon={GraduationCap}
              tone="mint"
            />
          </div>
        </div>

        <DeveloperCredit className="mt-12 md:hidden" />
      </main>

      <DeveloperCredit
        className={cn(
          'absolute z-10 hidden text-right md:block',
          'bottom-[calc(1.75rem+env(safe-area-inset-bottom))] right-[calc(2.25rem+env(safe-area-inset-right))]',
        )}
      />
    </div>
  )
}

const TONES = {
  blue: {
    iconWell: 'bg-gradient-to-br from-sky-50 to-blue-100/80 text-blue-600',
    arrow: 'bg-blue-600 group-hover:bg-blue-700',
    corner: 'from-blue-200/60',
    ring: 'focus-visible:outline-blue-600',
  },
  mint: {
    iconWell: 'bg-gradient-to-br from-emerald-50 to-teal-100/80 text-teal-600',
    arrow: 'bg-emerald-500 group-hover:bg-emerald-600',
    corner: 'from-emerald-200/60',
    ring: 'focus-visible:outline-emerald-600',
  },
} as const

interface RoleCardProps {
  to: string
  title: string
  subtitle: string
  icon: LucideIcon
  tone: keyof typeof TONES
}

function RoleCard({ to, title, subtitle, icon: Icon, tone }: RoleCardProps) {
  const t = TONES[tone]
  return (
    <Link
      to={to}
      className={cn(
        'kc-role-card group relative flex items-center gap-3 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 p-4 text-left min-[400px]:gap-4 min-[400px]:p-5 sm:gap-6 sm:p-7',
        'outline-none hover:border-slate-300/80 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-4',
        t.ring,
      )}
    >
      {/* soft wave in the card's corner, as in the reference design */}
      <span aria-hidden="true" className={cn('pointer-events-none absolute -bottom-10 -right-6 h-24 w-48 rotate-[-12deg] rounded-[100%] bg-gradient-to-tl to-transparent', t.corner)} />
      <span aria-hidden="true" className={cn('relative flex size-14 shrink-0 items-center justify-center rounded-full min-[400px]:size-16 sm:size-24', t.iconWell)}>
        <Icon className="size-7 min-[400px]:size-8 sm:size-11" strokeWidth={1.75} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-xl font-bold text-slate-900 sm:text-2xl">{title}</span>
        <span className="mt-1 block text-sm text-slate-500 sm:text-base">{subtitle}</span>
      </span>
      <span aria-hidden="true" className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors min-[400px]:size-11 sm:size-14', t.arrow)}>
        <ArrowRight className="size-5 sm:size-6" />
      </span>
    </Link>
  )
}

function DeveloperCredit({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs leading-relaxed text-slate-400', className)}>
      <span className="block">Developed by</span>
      <span className="block font-medium text-slate-500">Pakanan Modbut</span>
      <span className="block">© 2026 Class N</span>
    </p>
  )
}

/** Wave layer: two identical 1440-wide tiles, slid by one tile per cycle. */
const WAVE_TILE = (y: number, a: number) =>
  `M0,${y} C240,${y - a} 480,${y - a} 720,${y} C960,${y + a} 1200,${y + a} 1440,${y} ` +
  `C1680,${y - a} 1920,${y - a} 2160,${y} C2400,${y + a} 2640,${y + a} 2880,${y} L2880,320 L0,320 Z`

function RoleBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      {/* top-left: sky-blue flowing shapes */}
      <div className="kc-role-blob-a absolute -left-[16vw] -top-[30vh] h-[62vh] w-[58vw] min-w-[22rem] max-w-[56rem] will-change-transform" />
      <div className="kc-role-blob-b absolute -left-[10vw] -top-[14vh] h-[40vh] w-[34vw] min-w-[14rem] max-w-[36rem] will-change-transform" />

      {/* top-right: faint dot grid (desktop only) */}
      <div className="kc-role-dots absolute right-[6vw] top-[7vh] hidden h-28 w-36 opacity-70 md:block" />

      {/* bottom-right: pale-blue gradient shape */}
      <div className="kc-role-blob-c absolute -bottom-[26vh] -right-[14vw] h-[60vh] w-[44vw] min-w-[18rem] will-change-transform" />

      {/* bottom-left: layered waves */}
      <div className="kc-role-waves absolute bottom-0 left-0 h-[24vh] w-full min-h-[9rem] md:h-[34vh] md:w-[68vw]">
        {[
          { cls: 'kc-role-wave', y: 120, a: 34, fill: 'rgb(191 219 254 / 0.55)' },
          { cls: 'kc-role-wave kc-role-wave-2', y: 170, a: 28, fill: 'rgb(147 197 253 / 0.45)' },
          { cls: 'kc-role-wave kc-role-wave-3', y: 225, a: 22, fill: 'rgb(96 165 250 / 0.38)' },
        ].map((layer) => (
          <svg
            key={layer.y}
            className={cn(layer.cls, 'absolute bottom-0 left-0 h-full w-[200%] will-change-transform')}
            viewBox="0 0 2880 320"
            preserveAspectRatio="none"
          >
            <path d={WAVE_TILE(layer.y, layer.a)} fill={layer.fill} />
          </svg>
        ))}
      </div>
    </div>
  )
}
