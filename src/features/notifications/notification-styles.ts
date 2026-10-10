import type { NotificationTone } from './notification-model'

/** Mid-tone tints that read in both light and dark themes. */
export const TONE_STYLE: Record<NotificationTone, { icon: string; badge: string }> = {
  primary: { icon: 'bg-primary/12 text-primary', badge: 'bg-primary/12 text-primary' },
  success: { icon: 'bg-success/15 text-success', badge: 'bg-success/15 text-success' },
  warning: { icon: 'bg-warning/20 text-orange-600', badge: 'bg-warning/20 text-orange-600' },
  danger: { icon: 'bg-destructive/12 text-destructive', badge: 'bg-destructive/12 text-destructive' },
  info: { icon: 'bg-sky-500/15 text-sky-600', badge: 'bg-sky-500/15 text-sky-600' },
}
