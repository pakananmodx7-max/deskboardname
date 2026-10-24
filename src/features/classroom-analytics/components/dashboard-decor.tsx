import { cn } from '@/lib/utils'

/**
 * Decorative, data-free artwork for the dashboard (หน้าภาพรวม). Every
 * piece is inline SVG drawn in theme tokens (--primary / status tokens), so
 * it follows light and dark mode, adds no image assets, and is hidden
 * from assistive technology. Nothing here shows or implies data.
 */

/** Faint blue canvas behind the dashboard content (no artwork — the
 * blue & white theme keeps the page quiet). */
export function DashboardBackdrop() {
  return <div aria-hidden="true" className="kc-dashboard-backdrop pointer-events-none absolute -inset-4 -z-10 overflow-hidden sm:-inset-6" />
}

/** Clipboard-and-clock artwork for "no attendance yet". */
export function AttendanceEmptyArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 120" className={cn('h-28 w-36 shrink-0', className)}>
      <ellipse cx="80" cy="108" rx="58" ry="7" fill="var(--primary)" opacity="0.12" />
      <path d="M22 96 C 10 74, 20 54, 36 50 C 34 70, 40 84, 22 96 Z" fill="var(--primary)" opacity="0.14" />
      <path d="M134 92 C 150 76, 146 56, 132 50 C 130 68, 120 80, 134 92 Z" fill="var(--primary)" opacity="0.12" />
      <rect x="44" y="18" width="64" height="84" rx="10" fill="var(--card)" stroke="var(--primary)" strokeOpacity="0.55" strokeWidth="2" />
      <rect x="62" y="12" width="28" height="12" rx="5" fill="var(--primary)" opacity="0.75" />
      {[40, 56, 72].map((y) => (
        <g key={y}>
          <path d={`M54 ${y} l4 4 l7 -8`} fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="70" y={y - 3} width="28" height="5" rx="2.5" fill="var(--primary)" opacity="0.18" />
        </g>
      ))}
      <circle cx="110" cy="84" r="17" fill="var(--card)" stroke="var(--primary)" strokeWidth="2.5" />
      <path d="M110 75 v9 l6 4" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** Small bar-chart artwork for "no weekly trend yet" (shapes only — the
 * bars are illustrative, not data). */
export function TrendEmptyArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 120" className={cn('h-28 w-36 shrink-0', className)}>
      <ellipse cx="80" cy="106" rx="60" ry="7" fill="var(--primary)" opacity="0.12" />
      <path d="M30 100 C 18 80, 26 62, 40 58 C 40 76, 46 88, 30 100 Z" fill="var(--primary)" opacity="0.12" />
      <rect x="50" y="66" width="16" height="36" rx="4" fill="var(--primary)" opacity="0.45" />
      <rect x="74" y="48" width="16" height="54" rx="4" fill="var(--primary)" opacity="0.65" />
      <rect x="98" y="58" width="16" height="44" rx="4" fill="var(--primary)" opacity="0.5" />
      <path d="M50 44 L 76 30 L 92 38 L 120 18" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M110 16 L 122 16 L 122 28" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M132 100 C 146 84, 142 66, 130 62 C 128 78, 120 88, 132 100 Z" fill="var(--primary)" opacity="0.12" />
    </svg>
  )
}
