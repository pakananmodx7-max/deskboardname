import { TechText } from './tech-text'

/**
 * The interactive "Class N" brand mark (React Bits TechText): hover turns
 * a letter into dashes, click makes it bounce, letters can be dragged and
 * spring back, and an idle sweep runs when nobody is interacting (off
 * under prefers-reduced-motion). It fills its parent, so the caller sets
 * the size; colours come from --class-n-ink / --class-n-accent (light and
 * dark tokens in index.css). Used by the dashboard banner and the sign-in
 * pages' header.
 */
export function ClassNMark() {
  return (
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
  )
}
