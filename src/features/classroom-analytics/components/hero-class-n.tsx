import { TechText } from './tech-text'

/**
 * "Class N" on the right of the greeting banner — React Bits TechText:
 * hover turns a letter into dashes, click makes it bounce, letters can be
 * dragged and spring back, and an idle sweep runs when nobody is
 * interacting (off under prefers-reduced-motion, inside TechText). Colours
 * come from --class-n-ink / --class-n-accent (light and dark). It sits
 * beside the greeting text, never over it, and is left out on phones
 * where the greeting needs the full width. It reaches into the banner's
 * padding (negative margin) so the letter labels above the selection
 * frame have room without making the banner taller.
 */
export function HeroClassN() {
  return (
    <div data-testid="hero-class-n" className="hidden h-28 w-[34%] shrink-0 text-[var(--class-n-ink)] md:-my-4 md:block lg:-my-5 lg:h-32 lg:w-[38%]">
      <TechText
        text="Class N"
        fontWeight={700}
        fontSize={100}
        reveal="letter"
        dashLength={4}
        dashGap={2}
        specks={12}
        intro="none"
        introDuration={2}
        clickKick
        guides={false}
        fontFamily=""
        letterSpacing={-0.05}
        accentColor="var(--class-n-accent)"
        reach={150}
        softness={0.7}
        lineStyle="dashed"
        strokeWidth={1.5}
        speed={1}
        bounce={0.4}
        selection
        labels
        color="var(--class-n-ink)"
        align="center"
        draggable
        sweep
      />
    </div>
  )
}
