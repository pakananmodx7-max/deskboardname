import { cn } from '@/lib/utils'

/**
 * Decorative, data-free artwork for the dashboard (หน้าภาพรวม). Every
 * piece is inline SVG drawn in theme tokens (currentColor / --tone-*), so
 * it follows light and dark mode, adds no image assets, and is hidden
 * from assistive technology. Nothing here shows or implies data.
 */

/** Light-blue page canvas with soft edge glows and faint rings — fills
 * the main area behind the dashboard content. */
export function DashboardBackdrop() {
  return (
    <div aria-hidden="true" className="kc-dashboard-backdrop pointer-events-none absolute -inset-4 -z-10 overflow-hidden sm:-inset-6">
      <svg aria-hidden="true" className="absolute -left-16 bottom-10 hidden h-80 w-80 text-[var(--tone-mint)] opacity-[0.14] md:block" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="100" cy="100" r="96" />
        <circle cx="100" cy="100" r="70" />
        <circle cx="100" cy="100" r="44" />
      </svg>
    </div>
  )
}

/** Abstract shapes for the greeting banner (no people, buildings or
 * speech bubbles — shapes only). */
export function HeroDecoration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 360 160" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[22rem] sm:block" preserveAspectRatio="xMaxYMid slice">
      <circle cx="318" cy="22" r="64" fill="var(--tone-lavender)" opacity="0.14" />
      <circle cx="250" cy="150" r="46" fill="var(--tone-mint)" opacity="0.16" />
      <circle cx="318" cy="22" r="88" fill="none" stroke="var(--tone-blue)" strokeOpacity="0.18" strokeWidth="1.5" />
      <path d="M150 118 C 190 88, 228 132, 268 100 S 330 78, 360 92" fill="none" stroke="var(--tone-blue)" strokeOpacity="0.32" strokeWidth="2" strokeLinecap="round" />
      <path d="M170 136 C 205 114, 240 148, 280 122" fill="none" stroke="var(--tone-blue)" strokeOpacity="0.18" strokeWidth="2" strokeLinecap="round" />
      <g fill="var(--tone-blue)" opacity="0.28">
        {Array.from({ length: 12 }, (_, i) => (
          <circle key={i} cx={196 + (i % 4) * 12} cy={30 + Math.floor(i / 4) * 12} r="1.8" />
        ))}
      </g>
      <path d="M232 64 l5 -11 l5 11 l11 5 l-11 5 l-5 11 l-5 -11 l-11 -5 z" fill="var(--tone-orange)" opacity="0.45" />
    </svg>
  )
}

/** Corner artwork for a stat card, in the card's --tone — kept to the
 * bottom-right corner so it never crosses the card's text. */
export function StatDecoration({ variant }: { variant: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 96 80" className="pointer-events-none absolute -bottom-3 -right-3 h-20 w-24 text-[var(--tone)]">
      <circle cx="78" cy="66" r="40" fill="currentColor" opacity="0.1" />
      <circle cx="78" cy="66" r="24" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      {variant % 2 === 0 ? (
        <path d="M44 58 Q 58 44, 70 52 T 96 36" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <g fill="currentColor" opacity="0.3">
          {Array.from({ length: 6 }, (_, i) => (
            <circle key={i} cx={52 + (i % 3) * 8} cy={26 + Math.floor(i / 3) * 8} r="1.6" />
          ))}
        </g>
      )}
    </svg>
  )
}

/** Clipboard-and-clock artwork for "no attendance yet". */
export function AttendanceEmptyArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 120" className={cn('h-28 w-36 shrink-0', className)}>
      <ellipse cx="80" cy="108" rx="58" ry="7" fill="var(--tone-blue)" opacity="0.12" />
      <path d="M22 96 C 10 74, 20 54, 36 50 C 34 70, 40 84, 22 96 Z" fill="var(--tone-mint)" opacity="0.35" />
      <path d="M134 92 C 150 76, 146 56, 132 50 C 130 68, 120 80, 134 92 Z" fill="var(--tone-orange)" opacity="0.3" />
      <rect x="44" y="18" width="64" height="84" rx="10" fill="var(--card)" stroke="var(--tone-blue)" strokeOpacity="0.55" strokeWidth="2" />
      <rect x="62" y="12" width="28" height="12" rx="5" fill="var(--tone-blue)" opacity="0.75" />
      {[40, 56, 72].map((y) => (
        <g key={y}>
          <path d={`M54 ${y} l4 4 l7 -8`} fill="none" stroke="var(--tone-mint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="70" y={y - 3} width="28" height="5" rx="2.5" fill="var(--tone-blue)" opacity="0.18" />
        </g>
      ))}
      <circle cx="110" cy="84" r="17" fill="var(--card)" stroke="var(--tone-blue)" strokeWidth="2.5" />
      <path d="M110 75 v9 l6 4" fill="none" stroke="var(--tone-blue)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** Small bar-chart artwork for "no weekly trend yet" (shapes only — the
 * bars are illustrative, not data). */
export function TrendEmptyArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 120" className={cn('h-28 w-36 shrink-0', className)}>
      <ellipse cx="80" cy="106" rx="60" ry="7" fill="var(--tone-blue)" opacity="0.12" />
      <path d="M30 100 C 18 80, 26 62, 40 58 C 40 76, 46 88, 30 100 Z" fill="var(--tone-lavender)" opacity="0.28" />
      <rect x="50" y="66" width="16" height="36" rx="4" fill="var(--tone-blue)" opacity="0.45" />
      <rect x="74" y="48" width="16" height="54" rx="4" fill="var(--tone-blue)" opacity="0.65" />
      <rect x="98" y="58" width="16" height="44" rx="4" fill="var(--tone-blue)" opacity="0.5" />
      <path d="M50 44 L 76 30 L 92 38 L 120 18" fill="none" stroke="var(--tone-mint)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M110 16 L 122 16 L 122 28" fill="none" stroke="var(--tone-mint)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M132 100 C 146 84, 142 66, 130 62 C 128 78, 120 88, 132 100 Z" fill="var(--tone-orange)" opacity="0.3" />
    </svg>
  )
}
