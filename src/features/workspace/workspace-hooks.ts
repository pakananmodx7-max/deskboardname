import { createContext, useContext, useSyncExternalStore } from 'react'

import type { WorkspaceState, WorkspaceStore } from './workspace-store'

/** Provided by WorkspaceProvider (workspace-context.tsx). */
export const WorkspaceContext = createContext<WorkspaceStore | null>(null)

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceContext)
  if (!store) throw new Error('useWorkspaceStore must be used within WorkspaceProvider')
  return store
}

export function useWorkspaceState(): WorkspaceState {
  const store = useWorkspaceStore()
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
