import { ClassNMark } from '@/components/brand/class-n-mark'

/**
 * "Class N" on the right of the greeting banner (the shared interactive
 * mark). It sits beside the greeting text, never over it, and is left out
 * on phones where the greeting needs the full width. It reaches into the
 * banner's padding (negative margin) so the letter labels above the
 * selection frame have room without making the banner taller.
 */
export function HeroClassN() {
  return (
    <div data-testid="hero-class-n" className="hidden h-28 w-[34%] shrink-0 text-[var(--class-n-ink)] md:-my-4 md:block lg:-my-5 lg:h-32 lg:w-[38%]">
      <ClassNMark />
    </div>
  )
}
