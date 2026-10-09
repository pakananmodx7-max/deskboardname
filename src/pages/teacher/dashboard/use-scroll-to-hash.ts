import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Old bookmarks of the classroom list (/teacher/classrooms) redirect to
 * /teacher/dashboard#classrooms — scroll that section into view once it
 * has rendered. Runs once per hash; never loops or fights the user's
 * own scrolling afterwards.
 */
export function useScrollToHashSection(ready: boolean) {
  const { hash } = useLocation()
  useEffect(() => {
    if (!ready || !hash) return
    const id = decodeURIComponent(hash.slice(1))
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [ready, hash])
}
