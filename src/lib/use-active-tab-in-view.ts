import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keeps the active tab of a horizontally scrolling tab bar visible: on a
 * phone the bar is wider than the screen and the active tab (e.g. opened
 * via ?tab=…) could sit off-screen to the right. Only the bar's own
 * scrollLeft is changed — never the page scroll — and nothing happens
 * when the bar fits (desktop). Runs once per (bar element, active tab), so
 * it also catches a bar that mounts after loading, and never fights a
 * user's own scrolling.
 */
export function useActiveTabInView(container: RefObject<HTMLElement | null>, activeKey: string) {
  const done = useRef<{ bar: HTMLElement; key: string } | null>(null)
  useEffect(() => {
    const bar = container.current
    if (!bar || (done.current?.bar === bar && done.current.key === activeKey)) return
    done.current = { bar, key: activeKey }
    if (bar.scrollWidth <= bar.clientWidth) return
    const active = bar.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return
    const left = active.offsetLeft - bar.offsetLeft
    const right = left + active.offsetWidth
    if (left < bar.scrollLeft) bar.scrollTo({ left: Math.max(0, left - 16) })
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: right - bar.clientWidth + 16 })
  })
}
