import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

import { useStudentNotifications } from '@/hooks/use-student-notifications'
import type { MyNotification } from '@/types/student-portal'

interface StudentNotificationsContextValue {
  notifications: MyNotification[]
  unreadCount: number
  loading: boolean
  error: string | null
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** The most recently live-arrived notification not yet dismissed from
   * the top-right toast — null when there's nothing to show. */
  toastNotification: MyNotification | null
  dismissToast: () => void
}

const StudentNotificationsContext = createContext<StudentNotificationsContextValue | null>(null)

/**
 * Wraps StudentLayout so the bell (header), the dashboard's "ข้อความจากครู"
 * widget, and the top-right live toast all share exactly ONE
 * useStudentNotifications subscription/fetch — never one each, which
 * would triple the Realtime channels and risk the three surfaces
 * disagreeing on read state.
 */
export function StudentNotificationsProvider({
  studentId,
  children,
}: {
  studentId: string | null
  children: ReactNode
}) {
  const [toastNotification, setToastNotification] = useState<MyNotification | null>(null)

  const { notifications, unreadCount, loading, error, markRead, markAllRead } = useStudentNotifications(
    studentId,
    setToastNotification,
  )

  const dismissToast = useCallback(() => setToastNotification(null), [])

  return (
    <StudentNotificationsContext.Provider
      value={{ notifications, unreadCount, loading, error, markRead, markAllRead, toastNotification, dismissToast }}
    >
      {children}
    </StudentNotificationsContext.Provider>
  )
}

export function useStudentNotificationsContext(): StudentNotificationsContextValue {
  const ctx = useContext(StudentNotificationsContext)
  if (!ctx) throw new Error('useStudentNotificationsContext must be used within a StudentNotificationsProvider')
  return ctx
}
