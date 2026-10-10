import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useToast } from '@/components/ui/toast'
import { LOADING, success, type Resource } from '@/features/classroom-analytics/resource'
import { downloadName, readFavorites, sourcePath, writeFavorites, type DocumentItem } from '@/features/document-center/document-center-model'
import type { DriveConnection } from '@/features/document-center/document-center-ui'
import { DocumentCenterView } from '@/features/document-center/document-center-view'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { downloadDocumentFile, getDocumentFileUrl, listTeacherDocuments } from '@/services/document-center-service'
import { getGoogleConnectionStatus, startGoogleConnect } from '@/services/google-drive-service'

const NO_DOCUMENTS: Resource<DocumentItem[]> = success([])

/** Real mode: the teacher's attached files/links (RLS-scoped). */
function useDocumentsReal(): { data: Resource<DocumentItem[]>; reload: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ attempt: number; data: Resource<DocumentItem[]> } | null>(null)
  useEffect(() => {
    let active = true
    listTeacherDocuments().then(
      (items) => active && setResult({ attempt, data: success(items) }),
      (err: unknown) => active && setResult({ attempt, data: { status: 'error', error: toFriendlyErrorMessage(err, 'โหลดเอกสารไม่สำเร็จ') } }),
    )
    return () => {
      active = false
    }
  }, [attempt])
  return { data: result && result.attempt === attempt ? result.data : LOADING, reload: () => setAttempt((n) => n + 1) }
}

/** Demo Mode has no attached files — an honest empty list. */
function useDocumentsDemo(): { data: Resource<DocumentItem[]>; reload: () => void } {
  return { data: NO_DOCUMENTS, reload: () => {} }
}

/** Existing Google OAuth integration — status only, no new flow. */
function useDriveReal(): DriveConnection {
  const [drive, setDrive] = useState<DriveConnection>({ status: 'loading' })
  useEffect(() => {
    let active = true
    getGoogleConnectionStatus().then(
      (s) => active && setDrive(s.connected ? { status: 'connected', email: s.email } : { status: 'disconnected' }),
      () => active && setDrive({ status: 'error' }),
    )
    return () => {
      active = false
    }
  }, [])
  return drive
}

function useDriveDemo(): DriveConnection {
  return { status: 'unsupported' }
}

const useDocuments = dataMode === 'supabase' ? useDocumentsReal : useDocumentsDemo
const useDrive = dataMode === 'supabase' ? useDriveReal : useDriveDemo

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** /teacher/documents — ระบบเอกสาร (Phase 1). */
export function DocumentCenterPage() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data, reload } = useDocuments()
  const drive = useDrive()
  const [favoritesState, setFavoritesState] = useState(() => ({ userId, set: readFavorites(browserStorage(), userId) }))
  const favorites = favoritesState.userId === userId ? favoritesState.set : readFavorites(browserStorage(), userId)
  const [busyId, setBusyId] = useState<string | null>(null)

  const setFavorites = useCallback(
    (ids: string[], favorite: boolean) => {
      const next = new Set(favorites)
      for (const id of ids) {
        if (favorite) next.add(id)
        else next.delete(id)
      }
      writeFavorites(browserStorage(), userId, next)
      setFavoritesState({ userId, set: next })
    },
    [favorites, userId],
  )

  async function preview(item: DocumentItem) {
    if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
      return
    }
    // Open the tab synchronously (popup blockers), then point it at the
    // short-lived signed URL.
    const tab = window.open('about:blank', '_blank')
    setBusyId(item.id)
    try {
      const url = await getDocumentFileUrl(item)
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else {
        window.location.assign(url)
      }
    } catch (err) {
      tab?.close()
      toast(toFriendlyErrorMessage(err, 'เปิดไฟล์ไม่สำเร็จ'))
    } finally {
      setBusyId(null)
    }
  }

  async function download(item: DocumentItem) {
    if (!item.filePath) return
    setBusyId(item.id)
    try {
      await downloadDocumentFile(item, downloadName(item))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ดาวน์โหลดไฟล์ไม่สำเร็จ'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DocumentCenterView
      data={data}
      drive={drive}
      userId={userId}
      favorites={favorites}
      onSetFavorites={setFavorites}
      onRetry={reload}
      busyId={busyId}
      onConnectDrive={() => {
        startGoogleConnect().catch((err: unknown) => toast(toFriendlyErrorMessage(err, 'เริ่มการเชื่อมต่อ Google ไม่สำเร็จ')))
      }}
      onManageDrive={() => navigate('/teacher/integrations')}
      onPreview={(item) => void preview(item)}
      onDownload={(item) => void download(item)}
      onOpenSource={(item) => {
        const path = sourcePath(item)
        if (path) navigate(path)
      }}
      onCopyLink={(item) => {
        if (!item.url) return
        navigator.clipboard?.writeText(item.url).then(
          () => toast('คัดลอกลิงก์แล้ว'),
          () => toast('คัดลอกลิงก์ไม่สำเร็จ'),
        )
      }}
    />
  )
}
