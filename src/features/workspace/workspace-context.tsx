import { useEffect, useMemo, type ReactNode } from 'react'

import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { markUnsavedWork } from '@/lib/unsaved-work'
import { supabaseWorkspaceRepository } from '@/services/workspace-service'

import { demoWorkspaceRepository } from './workspace-demo-repository'
import { WorkspaceContext } from './workspace-hooks'
import { WorkspaceStore } from './workspace-store'
import type { WorkspaceRepository } from './workspace-types'

/** Re-reads the workspace when the tab comes back after this long (other devices). */
const REFRESH_AFTER_MS = 30_000

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

export function WorkspaceProvider({ children, repository }: { children: ReactNode; repository?: WorkspaceRepository }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const ownerKey = user?.id ?? 'demo'
  const repo = repository ?? (dataMode === 'demo' ? demoWorkspaceRepository : supabaseWorkspaceRepository)

  const store = useMemo(
    () => new WorkspaceStore(repo, { ownerKey, storage: safeLocalStorage(), isOnline, onError: (message) => toast(message, 'error') }),
    [repo, ownerKey, toast],
  )

  useEffect(() => {
    void store.load()
    return () => {
      void store.flushAll()
      store.dispose()
    }
  }, [store])

  // Another device may have changed things: refresh when the tab returns.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        void store.flushAll()
        return
      }
      const { loadedAt } = store.getState()
      if (loadedAt && Date.now() - loadedAt > REFRESH_AFTER_MS && !store.hasPendingWrites()) void store.load({ silent: true })
    }
    const onOnline = () => store.online()
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.hasPendingWrites()) return
      void store.flushAll()
      e.preventDefault()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [store])

  // Tell the PWA updater not to reload while a save is pending.
  useEffect(() => {
    let release: (() => void) | null = null
    const sync = () => {
      const pending = store.hasPendingWrites()
      if (pending && !release) release = markUnsavedWork()
      else if (!pending && release) {
        release()
        release = null
      }
    }
    const unsubscribe = store.subscribe(sync)
    return () => {
      unsubscribe()
      release?.()
    }
  }, [store])

  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>
}
